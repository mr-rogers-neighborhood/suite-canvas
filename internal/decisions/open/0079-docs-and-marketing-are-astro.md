# ADR-0079: Docs and marketing are Astro, docs on Starlight

- Status: proposed
- Date: 2026-10-26
- Related: `apps/docs` (the current Next build), the four sections under `docs/`, `deploy/Caddyfile`
  (three hosts)
- Shipped: nothing. `apps/docs` is a Next app on Fumadocs (`apps/docs/package.json`), and there is no
  `apps/site`.
- Remaining: `apps/site` (planned Astro marketing), `apps/docs` rebuilt on Starlight,
  `scripts/sync-docs.mjs` rewritten off `@fumadocs/local-md`, and the three-host Caddy config.

## Decision

Marketing is Astro at `suite.run` and docs are Astro with Starlight at `docs.suite.run`; the app stays
the Vite SPA at `app.suite.run`. Starlight keeps what the Fumadocs build has today: the dashboard
(`apps/docs/content/docs/index.md`), the four sections synced from `docs/` by
`scripts/sync-docs.mjs`, the per-page Markdown route
(`apps/docs/app/llms.mdx/docs/[[...slug]]/route.ts`), and `apps/docs/app/llms.txt/route.ts` with
`llms-full.txt`. Fumadocs cannot follow: `fumadocs-core@16.17.8` peers on `next`, `react-router`,
`@tanstack/react-router` and `waku`, and names no Astro entry.

## Rejected alternatives

- Fumadocs on Next for docs, Astro for marketing. Two frameworks and two toolchains for one public
  surface, and leaving Next was the point.
- The canvas as an Astro island. The app is one React tree over a WebGPU surface with a Tiptap editor
  per node; an island boundary buys nothing there and adds a hydration seam through the canvas.
- Plain Astro pages with no docs framework. Four sections, a sidebar, search and the per-page Markdown
  routes become hand-written layouts and hand-written routes.

## Consequences

- One framework for both public hosts, and the app keeps its Vite build.
- The Fumadocs components, its search index and its route handlers are rewritten in Starlight, and
  `scripts/sync-docs.mjs` loses `@fumadocs/local-md` and the `meta.json` files it emits.
- `llms.txt` and the per-page Markdown are integrations rather than free output, so each needs a test
  that notices its disappearance.
- Three hosts mean three Caddy entries and three certificates.
