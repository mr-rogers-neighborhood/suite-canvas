import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SUITE_UPDATE_STATE_FILE,
  type SuiteReleaseChannel,
  type SuiteUpdateState,
} from "@suite/contracts";

/**
 * The app's own update check, and the report it leaves behind.
 *
 * The app owns its bytes and its feed: it is the only process that may replace
 * this binary. The hub reads the report this writes rather than asking a feed of
 * its own, so the two can never disagree about what is newest, and a person who
 * opens the hub on a machine whose apps have not run in weeks still gets a
 * timestamped answer.
 *
 * `electron-updater` is imported on demand, and only in a packaged build with an
 * update config beside it: a checkout has no feed, and a dev run must not try to
 * replace itself.
 */
export interface UpdateCheckOptions {
  /** The app's machine-local state directory; the report is written here. */
  readonly dataDir: string;
  readonly version: string;
  readonly channel: SuiteReleaseChannel;
  /** False in a dev run, which has no `app-update.yml` to read. */
  readonly packaged: boolean;
  /** Overridable for a test, which must not spawn an updater. */
  readonly updater?: UpdaterLike;
  readonly now?: () => Date;
}

/** The part of `electron-updater` this module uses. */
export interface UpdaterLike {
  /** Set before the check: an app must never download a binary nobody asked for. */
  autoDownload: boolean;
  checkForUpdates(): Promise<{ updateInfo: { version: string } } | null>;
}

export interface UpdateCheckResult {
  readonly state: SuiteUpdateState;
  readonly error: string | null;
}

/** Ask the feed once, write the report, and say what happened. */
export async function checkForUpdates(options: UpdateCheckOptions): Promise<UpdateCheckResult> {
  const now = options.now ?? (() => new Date());
  const checkedAt = now().toISOString();

  if (!options.packaged && options.updater === undefined) {
    return {
      state: {
        format: "suite.update-state",
        version: options.version,
        available: null,
        checkedAt: null,
        channel: options.channel,
      },
      error: "this build has no update feed",
    };
  }

  const updater = options.updater ?? (await loadUpdater());
  if (updater === null) {
    return {
      state: {
        format: "suite.update-state",
        version: options.version,
        available: null,
        checkedAt: null,
        channel: options.channel,
      },
      error: "electron-updater is not available",
    };
  }

  // Never download unasked: an app that starts pulling a binary at launch is an
  // app that spends someone's bandwidth on a decision they did not make.
  updater.autoDownload = false;

  try {
    const result = await updater.checkForUpdates();
    const offered = result?.updateInfo.version ?? null;
    const state: SuiteUpdateState = {
      format: "suite.update-state",
      version: options.version,
      available: offered === null ? null : offered,
      checkedAt,
      channel: options.channel,
    };
    await writeReport(options.dataDir, state);
    return { state, error: null };
  } catch (error) {
    const state: SuiteUpdateState = {
      format: "suite.update-state",
      version: options.version,
      available: null,
      checkedAt,
      channel: options.channel,
    };
    await writeReport(options.dataDir, state);
    return { state, error: error instanceof Error ? error.message : "the check failed" };
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
