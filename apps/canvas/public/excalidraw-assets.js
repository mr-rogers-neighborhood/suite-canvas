/*
 * Excalidraw resolves `fonts/<Family>/<file>.woff2` beside the base named here,
 * and asks a CDN for them when it has none. A page policy that refuses
 * third-party fonts — `font-src 'self'` on the deployment, and the same on the
 * desktop shell — turns every sketch's text into a fallback face when the base
 * is missing, so it is set before the app's own module runs.
 *
 * This is a file rather than an inline script because the policy is
 * `script-src 'self'` with no `unsafe-inline`: an inline copy is blocked, which
 * would leave this unset and quietly reintroduce the CDN request. `vite.config.ts`
 * serves that directory from the package in development and copies it into the
 * bundle on build.
 */
window.EXCALIDRAW_ASSET_PATH = "/";
