import { join, sep } from "node:path";

/**
 * The page policy for the desktop renderer.
 *
 * It is the deployment's policy with two differences, and both are deliberate:
 *
 * - `connect-src 'self'` only. The desktop build is the `standalone` profile, so
 *   there is no relay and no account origin to reach; a page that cannot open a
 *   socket is a page that cannot leak a document, and it makes "works offline"
 *   structural rather than a promise.
 * - `wasm-unsafe-eval` is required: Loro's CRDT core is WebAssembly, and a
 *   sandboxed renderer without it cannot open a document at all.
 *
 * `style-src` keeps `unsafe-inline` because the app sets inline styles for the
 * theme, radius and density it restores before first paint. `script-src` does
 * not: the one inline script the app used to carry — the Excalidraw asset base —
 * is a file now, so script policy can stay strict.
 */
export const DESKTOP_CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** The `script-src` directive on its own, for a caller that checks the policy. */
export function scriptSrcDirective(policy: string = DESKTOP_CSP): string {
  return (
    policy
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("script-src")) ?? ""
  );
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: the control characters are the thing this rejects; a NUL in a path is never legitimate.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const APP_ORIGIN = "app://";

/**
 * Resolve a request to a file inside the renderer bundle, or refuse it.
 *
 * `app://canvas/...` is a real origin, so a document can keep the query-parameter
 * routes it already has (`?workspace=…`) and relative asset paths still resolve.
 *
 * The path is read from the **raw string**, not from `new URL(...).pathname`.
 * A WHATWG URL normalises `a/../b` to `b` before anyone can look at it, so a
 * climb would be silently reinterpreted as a legitimate path — the same trap
 * `parseDeepLink` avoids in `@suite/contracts`. Segments are refused rather than
 * resolved: nothing in the bundle is named `.` or `..`.
 */
export function resolveAppAsset(
  requestUrl: string,
  root: string,
): { readonly ok: true; readonly file: string } | { readonly ok: false } {
  if (!requestUrl.toLowerCase().startsWith(APP_ORIGIN)) return { ok: false };

  const afterOrigin = requestUrl.slice(APP_ORIGIN.length);
  const slash = afterOrigin.indexOf("/");
  const rawPath = slash < 0 ? "" : afterOrigin.slice(slash);

  const stops = [rawPath.indexOf("?"), rawPath.indexOf("#")].filter((index) => index >= 0);
  const pathOnly = stops.length > 0 ? rawPath.slice(0, Math.min(...stops)) : rawPath;

  const segments: string[] = [];
  for (const raw of pathOnly.split("/")) {
    if (raw === "") continue;
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return { ok: false };
    }
    if (segment === "." || segment === "..") return { ok: false };
    if (segment.includes("/") || segment.includes("\\")) return { ok: false };
    if (segment.length === 0 || CONTROL_CHARACTER.test(segment)) return { ok: false };
    segments.push(segment);
  }

  const relative = segments.length > 0 ? segments.join("/") : "index.html";
  const file = join(root, relative);
  // Defence in depth: whatever the segments were, the resolved path must sit
  // under the bundle, tested on a separator boundary so a sibling directory
  // sharing the prefix is not mistaken for the root.
  const directory = root.endsWith(sep) ? root.slice(0, -1) : root;
  if (file !== directory && !file.startsWith(`${directory}${sep}`)) return { ok: false };
  return { ok: true, file };
}
