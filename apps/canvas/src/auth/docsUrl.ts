/**
 * Where the self-host guide lives.
 *
 * The plan surface offers a third door beside the two prices, and that door is a link: running
 * Suite yourself costs nothing, asks for no licence and enforces no limit, so there is nothing to
 * buy and nothing to check out. It points at the published documentation, which a deployment
 * that serves its own copy of the docs can override with `VITE_SUITE_DOCS_URL`.
 *
 * The default is the public site rather than a path on this origin: a canvas deployment serves
 * the app, and the docs host is a different one (see `deploy/Caddyfile`).
 */
const DEFAULT_DOCS_URL = "https://docs.suite.run";

/** The one page a reader who wants to run it themselves should land on. */
export const SELF_HOST_PAGE = "/how-to/deploy/";

export function docsBaseUrl(): string {
  const configured = import.meta.env.VITE_SUITE_DOCS_URL;
  const base =
    typeof configured === "string" && configured.trim().length > 0
      ? configured.trim()
      : DEFAULT_DOCS_URL;
  return base.replace(/\/+$/u, "");
}

export function selfHostUrl(): string {
  return `${docsBaseUrl()}${SELF_HOST_PAGE}`;
}
