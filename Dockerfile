# RedLens Atlas — single-stage image (deliberately NOT multi-stage / slim).
# The in-process atlas updater (src/server/atlas-refresh.ts) re-runs
# build-index/build-graph and does `git fetch origin main` at RUNTIME, so the
# final image MUST carry: bun, git, the build scripts, node_modules, and the
# atlas submodule INCLUDING its .git. A slim runtime stage would break the
# updater — that's why this is one stage.
FROM oven/bun:1.3

# git: submodule init at build time + the runtime self-update fetch.
# python3: build-index runs the atlas's sync/compose.py (stdlib only) to
#   synthesize the monolithic "Sky Atlas.md" from content/** — it is generated,
#   not committed, so the updater needs python3 at RUNTIME too.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates python3 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Deps first so this layer caches across source-only changes.
COPY package.json ./
RUN bun install

# Then the repo. .git + .gitmodules are required here (submodule init at build,
# `git fetch` at runtime); node_modules/dist are excluded via .dockerignore.
COPY . .

# Populate the atlas submodule WITH its .git metadata, then build the lean
# artifact set (build:railway skips the Etherscan/RPC passes — committed
# artifacts ship in the image).
RUN git submodule update --init --recursive \
 && bun run build:railway

ENV PORT=3000
EXPOSE 3000

# Ordering invariant: PG current (sync:atlas, sha-gated → fast on steady-state
# boots) before the in-memory indexes load + serve.
CMD ["sh", "-c", "bun run sync:atlas && bun run start"]
