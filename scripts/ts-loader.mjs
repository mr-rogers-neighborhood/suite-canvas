/**
 * Lets a plain `node scripts/….mjs` import the repo's TypeScript sources.
 *
 * Two things stand in the way on their own:
 *
 *   1. The sources import their siblings as `./http.js`, which is what `tsc`
 *      and the bundler expect, but no such file exists on disk.
 *   2. Node's built-in type stripping refuses syntax that needs a real
 *      transform (parameter properties, enums), and `http.ts` uses one.
 *
 * `resolve` rewrites a `.js` specifier to the `.ts` file beside it, and `load`
 * transpiles it with the TypeScript compiler the repo already installs. Only
 * `scripts/generate-limits.mjs` uses this; nothing ships it to the app or the
 * server, and no dependency is added.
 */
import { existsSync, readFileSync } from "node:fs";
import { register, registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * `@suite/graph` resolves to `dist` unless the `development` condition is set,
 * and `dist` only exists after a build. Point it at the sources instead, so the
 * generator works on a clean checkout.
 */
const WORKSPACE_SOURCES = {
  "@suite/graph": "../packages/graph/src/index.ts",
};

export function resolve(specifier, context, next) {
  const source = WORKSPACE_SOURCES[specifier];
  if (source !== undefined) {
    const candidate = new URL(source, import.meta.url);
    if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
  }
  if (specifier.endsWith(".js") && context.parentURL?.startsWith("file:")) {
    const candidate = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
  }
  return next(specifier, context);
}

export function load(url, context, next) {
  if (!url.startsWith("file:") || !url.endsWith(".ts")) return next(url, context);
  const path = fileURLToPath(url);
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      verbatimModuleSyntax: false,
    },
  });
  return { format: "module", source: outputText, shortCircuit: true };
}

/** Synchronous hooks on Node 26+, the async loader on Node 22. */
export function registerTypeScript() {
  if (typeof registerHooks === "function") {
    registerHooks({ resolve, load });
    return;
  }
  register(import.meta.url);
}
