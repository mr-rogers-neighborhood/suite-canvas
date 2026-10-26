# syntax=docker/dockerfile:1

# The marketing page is one static file plus its inline stylesheet. The tree
# lands at `/srv/marketing`, the default of `SUITE_MARKETING_ROOT` in
# `deploy/Caddyfile`, and this container can also serve it on its own.

FROM node:22-bookworm-slim AS build
RUN npm install --global pnpm@12.13.0
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HUSKY=0
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @suite/site build

FROM caddy:2-alpine AS runtime
COPY --from=build /app/apps/site/dist /srv/marketing
EXPOSE 3002
CMD ["caddy", "file-server", "--root", "/srv/marketing", "--listen", ":3002"]
