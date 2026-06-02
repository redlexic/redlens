import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiUrl, type AuthUser } from "./api";

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  openAuth: () => void; // full-page redirect to GitHub OAuth
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

// Bootstraps auth from /api/auth/me. Tolerant of 401/404/network errors — on
// any failure the user is simply treated as signed-out (e.g. GH-Pages, where
// there is no backend), so a failed fetch never crashes the app shell.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(apiUrl("auth/me"), { credentials: "same-origin" })
      .then((res) => (res.ok ? (res.json() as Promise<AuthUser>) : null))
      .then((u) => alive && setUser(u))
      .catch(() => alive && setUser(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const openAuth = () => {
    window.location.href = apiUrl("auth/github");
  };

  const signOut = async () => {
    try {
      await fetch(apiUrl("auth/signout"), { method: "POST", credentials: "same-origin" });
    } catch {
      // ignore — clear local state regardless
    }
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, openAuth, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
