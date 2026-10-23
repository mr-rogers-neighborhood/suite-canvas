import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

// One config, two deployment profiles: `pnpm build` compiles the relay profile
// and `build:standalone` sets VITE_SUITE_MODE=standalone, which the app reads at
// build time (`src/session/mode.ts`). Both entry points are built either way.
export default defineConfig({
  plugins: [react(), tailwindcss(), wasm()],
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
        ice: "ice.html",
      },
    },
  },
});
