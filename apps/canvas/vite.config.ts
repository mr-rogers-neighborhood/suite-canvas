import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [react(), tailwindcss(), wasm()],
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
