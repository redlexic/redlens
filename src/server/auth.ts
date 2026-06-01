// GitHub OAuth (arctic) + the /api/auth/* routes. The session itself is a
// stateless JWT cookie (see session.ts); this module only mints it after a
// successful OAuth round-trip and exposes /me + /signout.
//
//   GET  /api/auth/github           → 302 to GitHub, CSRF state in a cookie
//   GET  /api/auth/github/callback  → verify state, exchange code, upsert user, set session
//   GET  /api/auth/me               → { id, name, avatarUrl, provider, email } | 401
//   POST /api/auth/signout          → clear session cookie
import { GitHub } from "arctic";
import { sql } from "./db.ts";
import { config } from "./config.ts";
import {
  getSessionUser,
  signSession,
  sessionCookie,
  clearSessionCookie,
  stateCookie,
  clearStateCookie,
  parseCookies,
  STATE_COOKIE,
  type SessionUser,
} from "./session.ts";

const SCOPES = ["read:user", "user:email"];

function github(): GitHub {
  return new GitHub(config.githubClientId, config.githubClientSecret, `${config.appUrl}/api/auth/github/callback`);
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
}

function json(body: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({ "content-type": "application/json" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(JSON.stringify(body), { status, headers });
}

interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  email: string | null;
}

async function ghFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "redlens-atlas" },
  });
  if (!res.ok) throw new Error(`github ${path} ${res.status}`);
  return (await res.json()) as T;
}

// GitHub omits email when the user keeps it private; /user/emails (needs user:email)
// carries the primary verified one. Best-effort — a missing email is non-fatal.
async function resolveEmail(gh: GithubUser, token: string): Promise<string | null> {
  if (gh.email) return gh.email;
  try {
    const emails = await ghFetch<{ email: string; primary: boolean; verified: boolean }[]>("/user/emails", token);
    return emails.find((e) => e.primary && e.verified)?.email ?? null;
  } catch {
    return null;
  }
}

async function upsertUser(providerId: string, email: string | null, name: string | null, avatar: string): Promise<SessionUser> {
  const rows = (await sql`
    INSERT INTO users (provider, provider_id, email, name, avatar_url)
    VALUES ('github', ${providerId}, ${email}, ${name}, ${avatar})
    ON CONFLICT (provider, provider_id)
    DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url
    RETURNING id
  `) as { id: string }[];
  return { id: rows[0].id, provider: "github" };
}

export async function handleAuth(req: Request, pathname: string): Promise<Response> {
  const sub = pathname.slice("/api/auth/".length);

  if (sub === "github" && req.method === "GET") {
    if (!config.githubClientId || !config.githubClientSecret) return json({ error: "oauth_not_configured" }, 500);
    const state = crypto.randomUUID();
    return redirect(github().createAuthorizationURL(state, SCOPES).toString(), [stateCookie(state)]);
  }

  if (sub === "github/callback" && req.method === "GET") {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieState = parseCookies(req.headers.get("cookie"))[STATE_COOKIE];
    if (!code || !state || !cookieState || state !== cookieState) {
      return json({ error: "invalid_oauth_state" }, 400, [clearStateCookie()]);
    }
    try {
      const tokens = await github().validateAuthorizationCode(code);
      const token = tokens.accessToken();
      const gh = await ghFetch<GithubUser>("/user", token);
      const email = await resolveEmail(gh, token);
      const user = await upsertUser(String(gh.id), email, gh.name ?? gh.login, gh.avatar_url);
      return redirect(`${config.appUrl}/`, [sessionCookie(await signSession(user)), clearStateCookie()]);
    } catch {
      return json({ error: "oauth_exchange_failed" }, 400, [clearStateCookie()]);
    }
  }

  if (sub === "me" && req.method === "GET") {
    const session = await getSessionUser(req);
    if (!session) return json({ error: "unauthenticated" }, 401);
    const rows = (await sql`
      SELECT id, provider, name, avatar_url, email FROM users WHERE id = ${session.user.id}
    `) as { id: string; provider: string; name: string | null; avatar_url: string | null; email: string | null }[];
    if (!rows[0]) return json({ error: "unauthenticated" }, 401, [clearSessionCookie()]);
    const u = rows[0];
    return json(
      { id: u.id, name: u.name, avatarUrl: u.avatar_url, provider: u.provider, email: u.email },
      200,
      session.refresh ? [session.refresh] : [],
    );
  }

  if (sub === "signout" && req.method === "POST") {
    return json({ ok: true }, 200, [clearSessionCookie()]);
  }

  return json({ error: "not_found" }, 404);
}
