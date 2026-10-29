/**
 * Where the source of this build lives.
 *
 * The launcher and the alpha notice both offer it, because "you can read it or run it yourself" is
 * the answer to most of the questions an alpha raises, and a reader should not have to guess the
 * address. A fork points this at itself with `VITE_SUITE_REPO_URL`.
 */
const DEFAULT_REPOSITORY_URL = "https://github.com/mr-rogers-neighborhood/suite-canvas";

export function repositoryUrl(): string {
  const configured = import.meta.env.VITE_SUITE_REPO_URL;
  const url =
    typeof configured === "string" && configured.trim().length > 0
      ? configured.trim()
      : DEFAULT_REPOSITORY_URL;
  return url.replace(/\/+$/u, "");
}
