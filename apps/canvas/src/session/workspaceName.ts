import {
  cleanWorkspaceName,
  DEFAULT_WORKSPACE_NAME,
  WorkspaceDocument,
  workspaceNameProblem,
} from "@suite/graph";
import { LoroDoc } from "loro-crdt";
import { LoroIndexeddbPersistence } from "../collab/loroPersistence";

/**
 * The name a workspace's own document cannot tell us until it is open: recents
 * are plain local metadata, so the last known name is mirrored here by
 * workspace id. A name stored in a cached document still wins, so a rename made
 * elsewhere is picked up by the next read.
 */
const NAMES_KEY = "suite.workspaceNames.v1";

export { DEFAULT_WORKSPACE_NAME, workspaceNameProblem };

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readWorkspaceNames(): Record<string, string> {
  if (!hasStorage()) return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(NAMES_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const names: Record<string, string> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (trimmed.length > 0) names[id] = trimmed;
    }
    return names;
  } catch {
    return {};
  }
}

function writeWorkspaceNames(names: Record<string, string>): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(NAMES_KEY, JSON.stringify(names));
  } catch {
    // A full or disabled localStorage must not break the launcher.
  }
}

const WORKSPACE_ADJECTIVES = [
  "Quiet",
  "Amber",
  "Bright",
  "Patient",
  "Curious",
  "Open",
  "Still",
  "Warm",
  "Clever",
  "Gentle",
  "Bold",
  "Copper",
] as const;

const WORKSPACE_NOUNS = [
  "Harbor",
  "Atlas",
  "Garden",
  "Workshop",
  "Library",
  "Compass",
  "Orchard",
  "Studio",
  "Archive",
  "Beacon",
  "Foundry",
  "Terrace",
] as const;

/**
 * A human default for a new workspace. The id stays opaque; this name is only
 * a label, so a repeated adjective-noun pair is harmless and still friendlier
 * than "Untitled workspace".
 */
export function friendlyWorkspaceName(): string {
  const adjective = WORKSPACE_ADJECTIVES[Math.floor(Math.random() * WORKSPACE_ADJECTIVES.length)];
  const noun = WORKSPACE_NOUNS[Math.floor(Math.random() * WORKSPACE_NOUNS.length)];
  return `${adjective} ${noun}`;
}

/** An invalid name throws its readable reason, like the document does. */
export function rememberWorkspaceName(id: string, name: string): void {
  writeWorkspaceNames({ ...readWorkspaceNames(), [id]: cleanWorkspaceName(name) });
}

export function forgetWorkspaceName(id: string): void {
  const names = readWorkspaceNames();
  if (!(id in names)) return;
  delete names[id];
  writeWorkspaceNames(names);
}

/**
 * The label for a recent row: an explicitly known name wins, then the last
 * board name we saw, then the neutral default. A workspace that has never been
 * opened has only the default to show until its document can be read.
 */
export function resolveWorkspaceName(
  stored: string | undefined,
  fallback: string | undefined,
): string {
  const chosen = stored?.trim() || fallback?.trim();
  return chosen && chosen.length > 0 ? chosen : DEFAULT_WORKSPACE_NAME;
}

/** A locally cached replica is what both Export and rename can act on. */
async function withCachedWorkspace<T>(
  id: string,
  act: (workspace: WorkspaceDocument, persistence: LoroIndexeddbPersistence) => Promise<T> | T,
): Promise<T | null> {
  if (typeof indexedDB === "undefined") return null;
  const doc = new LoroDoc();
  const persistence = new LoroIndexeddbPersistence(id, doc);
  try {
    await persistence.load();
    const workspace = new WorkspaceDocument(doc);
    // No snapshot and no cards means the relay holds the only copy: writing a
    // name here would fake a local document that Export would then refuse.
    if (workspace.listBoards().length === 0 && workspace.listCards().length === 0) return null;
    return await act(workspace, persistence);
  } finally {
    persistence.destroy();
  }
}

interface CachedNameReading {
  /** What the document calls itself, explicit or derived from its first board. */
  name: string;
  /** Whether the document stores a name rather than deriving one. */
  explicit: boolean;
}

async function cachedWorkspaceNameReading(id: string): Promise<CachedNameReading | null> {
  return withCachedWorkspace(id, (workspace) => ({
    name: workspace.workspaceName(),
    explicit: workspace.hasWorkspaceName(),
  }));
}

/**
 * Re-reads the name of every recent workspace that has a cached copy and keeps
 * the recents mirror in step. Renames made elsewhere arrive with the synced
 * document, so the launcher picks them up the next time it is shown; there is
 * deliberately no live subscription from a screen the workspace is not on.
 *
 * Derived names stay out of the mirror: a workspace that borrows its board's
 * name must follow that board when it is renamed. A mirrored name with no
 * document name behind it was set while the workspace was only a recent entry,
 * and is adopted into the document the first time a local copy exists.
 */
export async function refreshWorkspaceNames(ids: string[]): Promise<Record<string, string>> {
  const names = readWorkspaceNames();
  const readings = await Promise.all(
    ids.map(async (id) => {
      try {
        return [id, await cachedWorkspaceNameReading(id)] as const;
      } catch {
        return [id, null] as const;
      }
    }),
  );
  const resolved: Record<string, string> = { ...names };
  let changed = false;
  for (const [id, reading] of readings) {
    if (!reading) continue;
    if (reading.explicit) {
      if (names[id] !== reading.name) {
        names[id] = reading.name;
        changed = true;
      }
      resolved[id] = reading.name;
      continue;
    }
    const mirrored = names[id];
    if (!mirrored) {
      resolved[id] = reading.name;
      continue;
    }
    try {
      await renameCachedWorkspace(id, mirrored);
    } catch {
      // Keep the mirror; the next launcher visit retries.
    }
    resolved[id] = mirrored;
  }
  if (changed) writeWorkspaceNames(names);
  return resolved;
}

/**
 * Writes the name into the cached document itself. Returns false when the
 * workspace only exists as a recent entry (nothing local to write).
 */
export async function renameCachedWorkspace(id: string, name: string): Promise<boolean> {
  const trimmed = cleanWorkspaceName(name);
  const renamed = await withCachedWorkspace(id, async (workspace, persistence) => {
    workspace.renameWorkspace(trimmed);
    // The local update subscription would flush on a timer; the launcher is
    // about to navigate away, so write the snapshot before it can.
    await persistence.flush();
    return true;
  });
  return renamed === true;
}
