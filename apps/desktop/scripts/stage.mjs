import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copy what `tsc` cannot compile.
 *
 * The preload is CommonJS because a sandboxed preload cannot use ESM imports, so
 * it is not TypeScript and tsc leaves it alone. Copying it is the whole build
 * step beyond compilation; the renderer is the canvas bundle, which is staged
 * only when packaging.
 */
const root = dirname(fileURLToPath(import.meta.url));
const app = join(root, "..");

mkdirSync(join(app, "dist", "preload"), { recursive: true });
copyFileSync(join(app, "src", "preload", "index.cjs"), join(app, "dist", "preload", "index.cjs"));
