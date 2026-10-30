import { cpSync, createReadStream, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, normalize, sep } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import wasm from "vite-plugin-wasm";

/**
 * Excalidraw's own web fonts, served from this origin.
 *
 * The sketch surface asks for `fonts/<Family>/<file>.woff2` beside whatever base
 * `window.EXCALIDRAW_ASSET_PATH` names (set in `index.html`). Without a base it
 * falls back to a CDN, and the deployment's `font-src 'self'` refuses that, so
 * every sketch's text was drawn in a fallback face and each session logged the
 * refusal. The package ships the files, so they are served from it in
 * development and copied into the bundle on build: 13 MB of woff2 in the image,
 * of which a reader fetches only the family their own sketch uses.
 */
const excalidrawFonts = join(
  dirname(createRequire(import.meta.url).resolve("@excalidraw/excalidraw")),
  "fonts",
);

const FONT_TYPES: Record<string, string> = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

function excalidrawFontAssets(): Plugin {
  return {
    name: "suite:excalidraw-fonts",
    configureServer(server) {
      server.middlewares.use("/fonts", (request, response, next) => {
        const url = decodeURIComponent((request.url ?? "").split("?")[0] ?? "");
        const file = normalize(join(excalidrawFonts, url));
        // The mount is public, so a `..` in the url must not reach the package.
        if (
          !file.startsWith(excalidrawFonts + sep) ||
          !existsSync(file) ||
          !statSync(file).isFile()
        ) {
          next();
          return;
        }
        response.setHeader("Content-Type", FONT_TYPES[extname(file)] ?? "application/octet-stream");
        createReadStream(file).pipe(response);
      });
    },
    writeBundle(options) {
      cpSync(excalidrawFonts, join(options.dir ?? "dist", "fonts"), { recursive: true });
    },
  };
}

// One config, two deployment profiles: `pnpm build` compiles the relay profile
// and `build:standalone` sets VITE_SUITE_MODE=standalone, which the app reads at
// build time (`src/session/mode.ts`). Both entry points are built either way.
export default defineConfig({
  plugins: [react(), tailwindcss(), wasm(), excalidrawFontAssets()],
  server: {
    // The dev server stands in for the reverse proxy a deployment has in front of
    // it, so the page, the account API, the relay's HTTP API and the socket all
    // answer on one origin. Without this a browser on :5173 cannot read the
    // session cookie the control plane sets, and the account surface reports
    // itself unavailable in every local run.
    //
    // Order is the contract: Vite proxies by the first matching prefix, so the
    // control plane's mounts come before the relay's general `/api`.
    proxy: {
      "/api/auth": { target: "http://127.0.0.1:1236", changeOrigin: false },
      "/api/billing": { target: "http://127.0.0.1:1236", changeOrigin: false },
      "/api/account": { target: "http://127.0.0.1:1236", changeOrigin: false },
      "/api/templates": { target: "http://127.0.0.1:1236", changeOrigin: false },
      "/api/feedback": { target: "http://127.0.0.1:1236", changeOrigin: false },
      // The operator API, not the panel: `/admin.html` is a page Vite serves
      // itself, so only the control plane's own routes are forwarded. One that is
      // missing here does not fail loudly — it falls through to the SPA and the
      // panel reports a parse error — so every path the panel calls belongs in
      // this list alongside the matching `deploy/Caddyfile` matcher.
      "/admin/templates": { target: "http://127.0.0.1:1236", changeOrigin: false },
      "/admin/settings": { target: "http://127.0.0.1:1236", changeOrigin: false },
      "/admin/subscriptions": { target: "http://127.0.0.1:1236", changeOrigin: false },
      "/admin/accounts": { target: "http://127.0.0.1:1236", changeOrigin: false },
      "/admin/activity": { target: "http://127.0.0.1:1236", changeOrigin: false },
      "/admin/mail": { target: "http://127.0.0.1:1236", changeOrigin: false },
      "/api/workspaces": { target: "http://127.0.0.1:1236", changeOrigin: false },
      "/api/invites": { target: "http://127.0.0.1:1236", changeOrigin: false },
      "/stripe": { target: "http://127.0.0.1:1236", changeOrigin: false },
      "/api": { target: "http://127.0.0.1:1235", changeOrigin: false },
      "/ws": { target: "ws://127.0.0.1:1234", ws: true, changeOrigin: false },
    },
    watch: {
      // Test output lives under the canvas root (storybook-static) or one level
      // up (test-results, relay SQLite). A running dev server that reloads on
      // those files turns a passing test into a page that navigates under it.
      ignored: [
        "**/.artifacts/**",
        "**/.data/**",
        "**/coverage/**",
        "**/dist/**",
        "**/playwright-report/**",
        "**/storybook-static/**",
        "**/test-results/**",
        "**/*.sqlite",
        "**/*.sqlite-*",
      ],
    },
  },
  // A standalone build is static assets only. The store decides not to build its
  // sync provider from `isStandalone()`, so no define hack is needed here: the
  // profile is read through `VITE_SUITE_MODE` in `src/session/mode.ts`.
  build: {
    target: "esnext",
    rollupOptions: {
      // Two entry points: the workspace app and the operator panel. They share
      // no modules beyond React, so neither bundle imports the other's code.
      input: {
        main: "index.html",
        admin: "admin.html",
      },
    },
  },
});
