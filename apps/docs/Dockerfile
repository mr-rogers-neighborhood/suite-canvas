# syntax=docker/dockerfile:1

# The docs site is deployed separately from the app. It reads the Markdown in
# `docs/` at build time, so the image is self-contained and serves no API.

FROM node:22-bookworm-slim AS build
RUN npm install --global pnpm@12.13.0
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HUSKY=0
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @suite/docs build

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production \
    PORT=3001 \
    HOSTNAME=0.0.0.0
WORKDIR /app
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=build --chown=nextjs:nodejs /app/apps/docs/public ./apps/docs/public
COPY --from=build --chown=nextjs:nodejs /app/apps/docs/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/apps/docs/.next/static ./apps/docs/.next/static
USER nextjs
EXPOSE 3001
CMD ["node", "apps/docs/server.js"]
