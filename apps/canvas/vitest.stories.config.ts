import path from "node:path";
import { fileURLToPath } from "node:url";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import wasm from "vite-plugin-wasm";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Stories as tests. `storybookTest` reads `.storybook/main.ts` and turns every
 * CSF file it lists into a Vitest entry; running in a real Chromium (Playwright)
 * gives `play` functions layout, focus and event dispatch that jsdom lacks.
 */
export default defineConfig({
  root,
  plugins: [react(), tailwindcss(), wasm()],
  test: {
    projects: [
      {
        extends: true,
        plugins: [await storybookTest({ configDir: path.join(root, ".storybook") })],
        test: {
          name: "stories",
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
