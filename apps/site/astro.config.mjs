// @ts-check
import { defineConfig } from "astro/config";

/**
 * The marketing host: `suite.run`. Static output, one page, no framework and no
 * client script (ADR-0079). The app is `app.suite.run` and the docs are
 * `docs.suite.run`.
 */
export default defineConfig({
  site: "https://suite.run",
});
