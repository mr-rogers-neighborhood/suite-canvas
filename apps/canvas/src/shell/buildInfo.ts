/**
 * The build a page is running. A support report without this is a rumour: two
 * tabs of the same app can be different releases, and "it broke" is only
 * actionable next to the exact bundle that broke.
 *
 * `VITE_SUITE_VERSION` is stamped by the release build. A dev build has none,
 * and "dev" is the honest answer rather than a fake semver.
 */
export interface BuildInfo {
  version: string;
  mode: string;
  production: boolean;
}

export function buildInfo(env: ImportMetaEnv = import.meta.env): BuildInfo {
  return {
    version: env.VITE_SUITE_VERSION ?? "dev",
    mode: env.MODE,
    production: env.PROD,
  };
}

/** One line for a diagnostic block: `0.2.0-alpha.1 (production)`. */
export function buildLabel(info: BuildInfo = buildInfo()): string {
  return `${info.version} (${info.mode})`;
}
