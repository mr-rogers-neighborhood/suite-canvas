# @suite/docs

The browsable site over the repository's documentation, on Astro and Fumadocs.
**`docs/` and `handbook/` are the source of truth**; this app never holds a page of its own.

Two spaces share the site, with separate sidebars and separate entrances:

| Space | Source | Generated into | URL |
| --- | --- | --- | --- |
| Developer documentation | `docs/` | `src/content/docs/` by `scripts/sync-docs.mjs` | `/docs/**` |
| User handbook | `handbook/` | `src/content/handbook/` by `scripts/sync-handbook.mjs` | `/handbook/**` |

Both scripts add the frontmatter and the `_meta.json` sidebar Fumadocs needs, and rewrite what a
browser cannot resolve. `internal/` is local-only and never synced.

## Layout

| Path | Purpose |
| --- | --- |
| `astro.config.mjs` | The Fumadocs integration, the two collections, Tailwind and the code-block themes |
| `src/content.config.ts` | One page collection and one meta collection per space |
| `src/lib/source.ts` | The two Fumadocs sources, one per base URL |
| `src/pages/index.astro` | The portal: developer documentation and the user handbook, side by side |
| `src/pages/docs/[...slug].astro` | A developer page, rendered through `components/docs.tsx` |
| `src/pages/handbook/[...slug].astro` | A handbook article, the same layout and its own sidebar |
| `src/pages/*/[...slug].md.ts` | One page as Markdown, at the page's URL with `.md` appended |
| `src/pages/llms.txt.ts`, `llms-full.txt.ts` | The two agent endpoints, built from the collections |
| `src/pages/api/search.json.ts` | The static search index Fumadocs queries |
| `src/styles/global.css` | Tailwind, the Fumadocs preset, the app's accent and the portal |

The sidebar is data: each directory's `_meta.json` lists its pages in order, and the sync scripts
write them. The repository README is served at `/docs/overview`, because `/` is the portal.

## Run it

```sh
pnpm install
pnpm docs:site          # sync + astro dev, http://localhost:3001
```

## Build and serve

```sh
pnpm docs:site:build    # sync + astro build (output: apps/docs/dist)
pnpm docs:site:start    # astro preview on port 3001
```

Any static host works. `apps/docs/Dockerfile` builds the tree and serves it with Caddy on port 3001
at `/srv/docs`, which is what `deploy/Caddyfile` expects for `SUITE_DOCS_ROOT`.

## For agents

| Endpoint | Content |
| --- | --- |
| `/llms.txt` | the summary, then one line per page in both spaces |
| `/llms-full.txt` | every page, in full, in one file |
| `/docs/<slug>.md`, `/handbook/<slug>.md` | one page as Markdown |

Search is a static index built by `createFromSource(docsSource).staticGET()`, so the site needs no
search service and a preview deploy answers the same queries as production. The handbook is
navigated by its own sidebar, and searched inside the app.
