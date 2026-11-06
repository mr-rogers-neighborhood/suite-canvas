import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SUITE_UPDATE_STATE_FILE,
  type SuiteReleaseChannel,
  type SuiteUpdateState,
  updateAvailable,
} from "@suite/contracts";
import { checkSignedFeed, type FeedFetch, feedUrlFromAppUpdateYml } from "@suite/desktop";

/**
 * The app's own update check, and the report it leaves behind.
 *
 * The app owns its bytes and its feed: it is the only process that may replace this
 * binary. The hub reads the report this writes rather than asking a feed of its own,
 * so the two cannot disagree about what is newest.
 *
 * **The manifest is verified before anything else happens.** An update feed is one
 * URL, and anything that can answer it can offer a version; the artifact's sha512
 * protects a download, not the manifest that named it. A feed that answers without a
 * signature from the publisher is refused, and the app never asks its updater to act
 * on it.
 *
 * `electron-updater` is imported on demand, and only in a packaged build: a checkout
 * has no feed, and a dev run must not try to replace itself.
 */
export interface UpdateCheckOptions {
  /** The app's machine-local state directory; the report is written here. */
  readonly dataDir: string;
  readonly version: string;
  readonly channel: SuiteReleaseChannel;
  /** False in a dev run, which has no `app-update.yml` to read. */
  readonly packaged: boolean;
  /** Where `app-update.yml` lives. Defaults to the packaged resources directory. */
  readonly resourcesPath?: string;
  /** A feed to read instead of the recorded one. Tests use this. */
  readonly feed?: string;
  readonly updater?: UpdaterLike;
  readonly fetch?: FeedFetch;
  readonly platform?: string;
  readonly now?: () => Date;
}

/** The part of `electron-updater` this module uses. */
export interface UpdaterLike {
  /** Set before the check: an app must never download a binary nobody asked for. */
  autoDownload: boolean;
  checkForUpdates(): Promise<{ updateInfo: { version: string } } | null>;
}

export interface UpdateCheckResult {
  readonly state: SuiteUpdateState | null;
  readonly error: string | null;
  /** True only when the manifest that produced this answer was signed by the publisher. */
  readonly verified: boolean;
}

/** Ask the feed once, write the report, and say what happened. */
export async function checkForUpdates(options: UpdateCheckOptions): Promise<UpdateCheckResult> {
  const now = options.now ?? (() => new Date());
  const platform = options.platform ?? process.platform;
  const feed = options.feed ?? (await recordedFeed(options));

  if (feed === null) {
    return { state: null, error: "this build has no update feed", verified: false };
  }

  const check = await checkSignedFeed(feed, platform, options.fetch ?? ((url) => fetch(url)), now);
  if (!check.verified || check.version === null) {
    // No report: a card that says "checked" would be claiming an answer nobody gave.
    return {
      state: null,
      error: check.reason ?? "the feed could not be verified",
      verified: false,
    };
  }

  const state: SuiteUpdateState = {
    format: "suite.update-state",
    version: options.version,
    available: updateAvailable({
      format: "suite.update-state",
      version: options.version,
      available: check.version,
      checkedAt: check.checkedAt,
      channel: options.channel,
    })
      ? check.version
      : null,
    checkedAt: check.checkedAt,
    channel: options.channel,
  };

  // The version came from the verified manifest, so the download has something
  // trustworthy to compare against. The updater still verifies the artifact's hash.
  const updater = options.updater ?? (await loadUpdater());
  if (updater !== null && state.available !== null) {
    updater.autoDownload = false;
    await updater.checkForUpdates().catch((error: unknown) => {
      console.warn("[update] the updater could not check", error);
    });
  }

  await writeReport(options.dataDir, state);
  return { state, error: null, verified: true };
}

/** The feed electron-builder recorded beside a packaged app. */
async function recordedFeed(options: UpdateCheckOptions): Promise<string | null> {
  if (!options.packaged) return null;
  const resources = options.resourcesPath ?? process.resourcesPath;
  try {
    const yml = await readFile(join(resources, "app-update.yml"), "utf8");
    return feedUrlFromAppUpdateYml(yml);
  } catch {
    return null;
  }
}

/** The report's path inside an app's data directory. */
export function reportPath(dataDir: string): string {
  return join(dataDir, SUITE_UPDATE_STATE_FILE);
}

/** Write the report the hub reads. Failure is logged, never thrown: a report is a courtesy. */
export async function writeReport(dataDir: string, state: SuiteUpdateState): Promise<void> {
  try {
    await writeFile(reportPath(dataDir), `${JSON.stringify(state, null, 2)}\n`);
  } catch (error) {
    console.warn("[update] the report could not be written", error);
  }
}

/** `electron-updater`, or null when it cannot be loaded. */
async function loadUpdater(): Promise<UpdaterLike | null> {
  try {
    const module = await import("electron-updater");
    return module.autoUpdater;
  } catch {
    return null;
  }
}
