# syntax=docker/dockerfile:1

# One image runs the collab server; the `web` target serves the built canvas.
# Both targets are built from the same checkout, so a hosted instance and a
# self-hosted one are the same artifact.

FROM node:22-bookworm-slim AS base
RUN npm install --global pnpm@12.13.0
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

# Install once, with every workspace manifest, so the lockfile stays frozen.
FROM base AS deps
ENV HUSKY=0
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY patches ./patches
COPY apps/canvas/package.json apps/canvas/package.json
COPY apps/collab-server/package.json apps/collab-server/package.json
COPY apps/control-plane/package.json apps/control-plane/package.json
COPY packages/graph/package.json packages/graph/package.json
COPY packages/licence/package.json packages/licence/package.json
COPY e2e/package.json e2e/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @suite/graph build && pnpm --filter @suite/canvas build

# Server runtime. The server runs TypeScript through `tsx`, so the workspace's
# development dependencies stay installed; that keeps this image to one build
# step instead of a second compile pipeline.
FROM base AS runtime
# The version stamp reported by /metrics, /api/admin/status and the startup log.
# CI passes the git tag; a local build falls back to this value, and
# apps/collab-server/package.json is the last resort inside the image.
ARG SUITE_VERSION=0.0.0
ENV NODE_ENV=production \
    PORT=1234 \
    HEALTH_PORT=1235 \
    SUITE_VERSION=${SUITE_VERSION}
WORKDIR /app
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
# The runtime image is a subset of the workspace, so the pre-run dependency
# check would try to reinstall on every start. Running the server needs none.
RUN printf '\nverifyDepsBeforeRun: false\n' >> pnpm-workspace.yaml
COPY --from=build /app/apps/canvas/package.json ./apps/canvas/package.json
COPY --from=build /app/apps/collab-server/package.json ./apps/collab-server/package.json
COPY --from=build /app/packages/graph/package.json ./packages/graph/package.json
COPY --from=build /app/e2e/package.json ./e2e/package.json
COPY --from=build /app/apps/collab-server/src ./apps/collab-server/src
COPY --from=build /app/packages/graph/dist ./packages/graph/dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/collab-server/node_modules ./apps/collab-server/node_modules
COPY --from=build /app/packages/graph/node_modules ./packages/graph/node_modules
EXPOSE 1234 1235
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HEALTH_PORT||1235)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@suite/collab-server", "start"]

# The control plane: accounts, billing and the Postgres they share. Same
# checkout and same install as the relay, a different entry point -- the two
# processes stay separate because the relay must keep syncing when the account
# service is down, and because a document server has no business holding
# Stripe's signing secrets.
#
# It mounts route modules it does not import, so this image carries no
# `services/*` source: `apps/control-plane/src/modules/*.ts` are copied as they
# are, and a module that is absent is a health line, not a build failure.
FROM base AS control-plane
ARG SUITE_VERSION=0.0.0
ENV NODE_ENV=production \
    PORT=1236 \
    SUITE_VERSION=${SUITE_VERSION}
WORKDIR /app
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
RUN printf '\nverifyDepsBeforeRun: false\n' >> pnpm-workspace.yaml
COPY --from=build /app/apps/control-plane/package.json ./apps/control-plane/package.json
COPY --from=build /app/apps/control-plane/src ./apps/control-plane/src
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/control-plane/node_modules ./apps/control-plane/node_modules
EXPOSE 1236
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||1236)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@suite/control-plane", "start"]

# TLS terminator and static host. The canvas build is baked in at /srv.
FROM caddy:2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/canvas/dist /srv
EXPOSE 80 443
