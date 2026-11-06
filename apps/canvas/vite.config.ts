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

// One profile: the app, as a static bundle that reaches nothing.
export default defineConfig({
  plugins: [react(), tailwindcss(), wasm(), excalidrawFontAssets()],
  server: {
    watch: {
      // Test output lives under the canvas root (storybook-static) or one level
      // up (test-results). A running dev server that reloads on those files turns
      // a passing test into a page that navigates under it.
      ignored: [
        "**/.artifacts/**",
        "**/.data/**",
        "**/coverage/**",
        "**/dist/**",
        "**/playwright-report/**",
        "**/storybook-static/**",
        "**/test-results/**",
      ],
    },
  },
  // The dev server serves the app and nothing else. There is no API to proxy to.
  build: {
    target: "esnext",
    rollupOptions: {
      input: { main: "index.html" },
    },
  },
});
