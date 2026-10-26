# syntax=docker/dockerfile:1

# The docs site is deployed separately from the app. It reads the Markdown in
# `docs/` at build time, so the image is one static tree and no server runtime.
#
# The tree lands at `/srv/docs`, which is the default of `SUITE_DOCS_ROOT` in
# `deploy/Caddyfile`: a deployment can serve it from the `web` image's Caddy or
# from this container's own file server on 3001.

FROM node:22-bookworm-slim AS build
RUN npm install --global pnpm@12.13.0
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HUSKY=0
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @suite/docs build

FROM caddy:2-alpine AS runtime
COPY --from=build /app/apps/docs/dist /srv/docs
EXPOSE 3001
CMD ["caddy", "file-server", "--root", "/srv/docs", "--listen", ":3001"]
