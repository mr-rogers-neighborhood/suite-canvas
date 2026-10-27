import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

// One config, two deployment profiles: `pnpm build` compiles the relay profile
// and `build:standalone` sets VITE_SUITE_MODE=standalone, which the app reads at
// build time (`src/session/mode.ts`). Both entry points are built either way.
export default defineConfig({
  plugins: [react(), tailwindcss(), wasm()],
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
      // itself, so only the template routes are forwarded.
      "/admin/templates": { target: "http://127.0.0.1:1236", changeOrigin: false },
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
