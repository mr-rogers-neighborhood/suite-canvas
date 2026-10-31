// @ts-check
import fumadocs from "@fumadocs/astro";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

/**
 * The docs host. `docs.suite.run` serves this site at its root; the app is
 * `app.suite.run` and the marketing page is `suite.run` (ADR-0079).
 *
 * Two spaces share one site. `src/content/docs/` and `src/content/handbook/` are both generated:
 * the developer pages by `scripts/sync-docs.mjs` from `docs/`, and the user handbook by
 * `scripts/sync-handbook.mjs` from `handbook/`. Nothing under `src/content/` is edited by hand,
 * which is why the portal and the two layouts are the only pages this app owns.
 *
 * Fumadocs rather than Starlight, for the theme and for the two-space sidebar: each collection has
 * its own loader and its own base URL, so the developer pages and the handbook never share a
 * navigation tree.
 */
export default defineConfig({
  site: "https://docs.suite.run",
  // The old Starlight site served the repository README at `/overview/`; the developer pages live
  // under `/docs/` now, so the two entry points that existed are forwarded.
  redirects: {
    "/overview": "/docs/overview",
  },
  integrations: [
    fumadocs({
      collections: {
        docs: { dir: "src/content/docs" },
        handbook: { dir: "src/content/handbook" },
      },
      components: "./src/components/mdx.tsx",
      includeProcessedMarkdown: true,
      // The docs are written by hand, so a fence can name a language Shiki has no grammar for
      // (`cron`, a branded CLI). A plain block is a better answer than a build that refuses the
      // page, and `docs:check` still keeps the fences balanced.
      rehypeCodeOptions: {
        themes: { light: "github-light", dark: "github-dark" },
        fallbackLanguage: "text",
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
