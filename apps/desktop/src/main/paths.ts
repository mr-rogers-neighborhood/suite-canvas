import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { suitePaths } from "@suite/contracts";

/**
 * Where a desktop canvas keeps its things.
 *
 * Two roots, and the split is the decision:
 *
 * - **Documents** — `~/Documents/Suite/Canvas`. A workspace file goes where a
 *   person looks, so it can be copied, backed up, or put in a folder their own
 *   cloud already syncs. That is local-first without a relay.
 * - **Data** — the per-user application directory. Locks and machine-local state
 *   live here, never beside the file: a synced folder would carry another
 *   machine's process id, and every sync would look like a contended file.
 *
 * Backups stay beside the document, because "recover with a file manager when
 * the app is the thing that broke" is a promise the format already makes.
 */

export interface DesktopPaths {
  /** Default directory for workspace files. */
  readonly library: string;
  /** Machine-local state: locks, and anything that must not sync. */
  readonly data: string;
  readonly locks: string;
}

/**
 * Resolve the roots for a platform.
 *
 * The convention itself lives in `@suite/contracts`, so the three apps cannot
 * drift into three answers to "where does a file go". What stays here is the
 * canvas's own overrides: `SUITE_CANVAS_LIBRARY` and `SUITE_CANVAS_DATA`, which
 * exist for a test and a portable install. Neither is read from a document, so no
 * file can steer a write.
 */
export function desktopPaths(
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): DesktopPaths {
  const paths = suitePaths("Canvas", {
    platform,
    home,
    documentsOverride: process.env.SUITE_CANVAS_LIBRARY,
    dataOverride: process.env.SUITE_CANVAS_DATA,
    xdgDataHome: process.env.XDG_DATA_HOME,
  });
  return { library: paths.documents, data: paths.data, locks: paths.locks };
}

/**
 * The lock's file name for a document.
 *
 * A hash rather than the path itself: a path is not a legal file name on every
 * platform, it leaks the user's directory layout into the data directory, and it
 * can exceed the length limit. The hash is only ever compared to itself.
 */
export function lockFileName(documentPath: string): string {
  // Case-folded on the platforms whose filesystems are, so two spellings of one
  // file cannot hold two locks.
  const normalised = process.platform === "linux" ? documentPath : documentPath.toLowerCase();
  return `${createHash("sha256").update(normalised).digest("hex")}.json`;
}

/** The name a `.canvas` file gets from a workspace title, without the extension. */
export function fileStem(title: string): string {
  const cleaned = title
    .normalize("NFKD")
    // Anything a filesystem or a shell would rather not carry becomes a dash.
    .replace(/[^A-Za-z0-9 _-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 80)
    .trim();
  // A reserved device name is not writable on Windows, whatever its case.
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(cleaned)) return "workspace";
  return cleaned.length > 0 ? cleaned : "workspace";
}
