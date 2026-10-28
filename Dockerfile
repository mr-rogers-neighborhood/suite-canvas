# syntax=docker/dockerfile:1

# Three images from one checkout: `runtime` runs the relay, `control-plane` runs
# accounts and billing, and `web` serves the built canvas behind Caddy. A hosted
# instance and a self-hosted one are the same artifacts.
#
# Dependency stages are split so a runtime image never carries the toolchain.
# `deps` installs everything (the build needs TypeScript, Vite and the test
# types); `prod-deps` installs the production graph of the two server packages
# only, so the shipped `node_modules` has no compiler, bundler, test runner or
# linter.

FROM node:22-bookworm-slim AS base
RUN npm install --global pnpm@12.13.0
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

# Every workspace manifest, and nothing else: one install, one lockfile, and a
# new workspace has to be added here deliberately.
FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY patches ./patches
COPY apps/canvas/package.json apps/canvas/package.json
COPY apps/collab-server/package.json apps/collab-server/package.json
COPY apps/control-plane/package.json apps/control-plane/package.json
COPY apps/docs/package.json apps/docs/package.json
COPY apps/site/package.json apps/site/package.json
COPY e2e/package.json e2e/package.json
COPY packages/graph/package.json packages/graph/package.json
COPY packages/import-obsidian/package.json packages/import-obsidian/package.json
COPY packages/licence/package.json packages/licence/package.json
COPY packages/settings/package.json packages/settings/package.json
COPY services/auth/package.json services/auth/package.json
COPY services/billing/package.json services/billing/package.json

# Build-time install: development dependencies included on purpose.
FROM manifests AS deps
ENV HUSKY=0
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

# Ship-time install: `--prod`, and only the two server packages plus the
# workspace packages they depend on. `...` selects the dependency closure, which
# is what gives `@suite/auth`, `@suite/graph` and `@suite/licence` their own
# `node_modules` links. No development dependency survives this: no TypeScript,
# Vite, Vitest, Biome, Stryker or Turbo. What does survive is the production
# closure of `@suite/auth` and `@suite/billing`, which is why `better-auth`'s own
# React and Next adapters are in here; they are the packages' dependencies, not
# ours, and pruning them would break the packages that declare them.
FROM manifests AS prod-deps
ENV HUSKY=0
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --prod --frozen-lockfile \
  --filter @suite/collab-server... \
  --filter @suite/control-plane...

FROM deps AS build
# The canvas is built here, so every value it inlines has to be a build argument: Vite
# replaces `import.meta.env.VITE_*` at build time, and a variable the runtime has is too
# late. `SUITE_TURNSTILE_SITE_KEY` is public by design (it is the widget's site key), and
# leaving it out while `SUITE_TURNSTILE_SECRET` is set is a sign-up form that can never
# satisfy the challenge.
ARG SUITE_VERSION=0.0.0
ARG SUITE_TURNSTILE_SITE_KEY=""
ARG SUITE_AUTH_URL=""
ARG SUITE_CRASH_DSN=""
ENV VITE_SUITE_VERSION=${SUITE_VERSION} \
    VITE_SUITE_TURNSTILE_SITE_KEY=${SUITE_TURNSTILE_SITE_KEY} \
    VITE_SUITE_AUTH_URL=${SUITE_AUTH_URL} \
    VITE_SUITE_CRASH_DSN=${SUITE_CRASH_DSN}
COPY . .
# Every package the canvas and the servers import is built here, because a
# `dist` that is missing from the context (`.dockerignore`) is a resolution
# failure at build time, not a stale file. `@suite/auth` is the exception: it is
# TypeScript read through `tsx`, and a second compile pipeline would drift from
# the one `pnpm typecheck` gates.
RUN pnpm --filter @suite/graph build \
  && pnpm --filter @suite/licence build \
  && pnpm --filter @suite/settings build \
  && pnpm --filter @suite/billing build \
  && pnpm --filter @suite/import-obsidian build \
  && pnpm --filter @suite/canvas build \
  && pnpm --filter @suite/docs build \
  && pnpm --filter @suite/site build

# The runtime base both servers share: a non-root user, a writable /data, and
# nothing else writable. The sources stay TypeScript and are executed through
# `tsx`; docs/how-to/operate.md records that decision next to the commands.
FROM base AS server-base
# `tsx` is the runtime for the TypeScript sources: installed globally and
# pinned, so the image needs no `typescript` package and no `ts-node`.
RUN npm install --global tsx@4.23.15 \
  && mkdir -p /data \
  && chown node:node /data
ENV NODE_ENV=production \
    HOME=/home/node
# The production dependency tree and the manifests that name it. Every workspace
# package a server imports has to be here, or the process starts and then fails
# to resolve it; `@suite/auth` and `@suite/licence` were the two that were
# missing (see "Images" in docs/how-to/deploy.md).
COPY --from=prod-deps /app ./
USER node

# The relay. It owns the six SQLite stores under /data and speaks Loro over
# `PORT`; `/health` and the HTTP API share `HEALTH_PORT`.
FROM server-base AS runtime
ARG SUITE_VERSION=0.0.0
ENV PORT=1234 \
    HEALTH_PORT=1235 \
    SUITE_VERSION=${SUITE_VERSION}
COPY --from=build --chown=root:root /app/apps/collab-server/src ./apps/collab-server/src
COPY --from=build --chown=root:root /app/packages/graph/dist ./packages/graph/dist
COPY --from=build --chown=root:root /app/packages/licence/dist ./packages/licence/dist
COPY --from=build --chown=root:root /app/packages/settings/dist ./packages/settings/dist
COPY --from=build --chown=root:root /app/services/auth/src ./services/auth/src
COPY --from=build --chown=root:root /app/services/auth/sql ./services/auth/sql
EXPOSE 1234 1235
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HEALTH_PORT||1235)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["tsx", "apps/collab-server/src/server.ts"]

# The control plane: accounts, billing and the Postgres they share. Same
# checkout and same install as the relay, a different entry point -- the two
# processes stay separate because the relay must keep syncing when the account
# service is down, and because a document server has no business holding
# Stripe's signing secrets.
#
# It mounts route modules it does not import, so `apps/control-plane/src/modules`
# is copied as it is, and a module that is absent is a health line, not a build
# failure.
FROM server-base AS control-plane
ARG SUITE_VERSION=0.0.0
ENV PORT=1236 \
    SUITE_VERSION=${SUITE_VERSION}
COPY --from=build --chown=root:root /app/apps/control-plane/src ./apps/control-plane/src
COPY --from=build --chown=root:root /app/services/auth/src ./services/auth/src
COPY --from=build --chown=root:root /app/services/auth/sql ./services/auth/sql
COPY --from=build --chown=root:root /app/services/billing/dist ./services/billing/dist
# The settings registry the admin surface and the boot overlay both import. A
# workspace package a module imports has to be here or the module fails to load and
# `/health` says so — which is how this one was found.
COPY --from=build --chown=root:root /app/packages/settings/dist ./packages/settings/dist
EXPOSE 1236
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||1236)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["tsx", "apps/control-plane/src/server.ts"]

# TLS terminator and static host. The canvas build is baked in at /srv.
FROM caddy:2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/canvas/dist /srv
# The documentation tree, in the image that serves it. Caddy can only answer
# `docs.suite.run` from its own filesystem, so a separate container holding the
# tree was a second copy of a static site that this host could not read: the
# docs host answered 404 forever. `SUITE_DOCS_ROOT` defaults to exactly this path.
COPY --from=build /app/apps/docs/dist /srv/docs
# The marketing page, for the same reason: a host that answers `suite.run` has to hold the
# tree, and `SUITE_MARKETING_ROOT` defaults to exactly this path.
COPY --from=build /app/apps/site/dist /srv/marketing
EXPOSE 80 443
