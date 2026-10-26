/**
 * The owner recovery kit: a small JSON file holding the owner key, deliberately
 * separate from a `.suite` backup. A document backup is copied, attached and
 * shared for debugging; a key inside it would silently hand over ownership, so
 * recovery lives in its own `.suitekey` file.
 */

import { deleteWorkspaceDocument } from "../collab/loroPersistence";
import { forgetOwnerKey } from "./ownerKey";
import { downloadText, fileStem, forgetWorkspace } from "./workspaceTransfer";

export const OWNER_KIT_KIND = "suite.owner";
export const OWNER_KIT_VERSION = 1;
export const OWNER_KIT_EXTENSION = ".suitekey";
const RECOVERY_SAVED_PREFIX = "suite.recoverySaved.";
export const OWNER_KIT_MISMATCH = "That owner file does not own this workspace.";

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/** What this browser recorded about the last recovery download. */
export interface SavedRecoveryKey {
  /** Download time; `null` for a flag written before timestamps. */
  savedAt: number | null;
}

/**
 * The saved flag is a record of a download, not a claim that the file still
 * exists, so it carries a time. Old plain `"1"` values still read as saved.
 */
export function readSavedRecoveryKey(workspaceId: string): SavedRecoveryKey | null {
  if (!hasStorage()) return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(`${RECOVERY_SAVED_PREFIX}${workspaceId}`);
  } catch {
    return null;
  }
  if (raw === null || raw.length === 0) return null;
  if (raw === "1") return { savedAt: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const savedAt = (parsed as Record<string, unknown>).savedAt;
    if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return null;
    return { savedAt };
  } catch {
    return null;
  }
}

/** True when this browser has downloaded an owner file for the workspace. */
export function hasSavedRecoveryKey(workspaceId: string): boolean {
  return readSavedRecoveryKey(workspaceId) !== null;
}

/** Records the download time and returns it so the caller can show it. */
function markRecoveryKeySaved(workspaceId: string): SavedRecoveryKey {
  const saved = { savedAt: Date.now() };
  if (!hasStorage()) return saved;
  try {
    window.localStorage.setItem(`${RECOVERY_SAVED_PREFIX}${workspaceId}`, JSON.stringify(saved));
  } catch {
    // Convenience flag only; a full storage must not block the download.
  }
  return saved;
}

/** A rotated key invalidates the old file, so the next backup should ask again. */
export function clearSavedRecoveryKey(workspaceId: string): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(`${RECOVERY_SAVED_PREFIX}${workspaceId}`);
  } catch {
    // Ignore.
  }
}

/** The envelope of a `.suitekey` file. */
export interface OwnerKit {
  kind: typeof OWNER_KIT_KIND;
  version: typeof OWNER_KIT_VERSION;
  workspaceId: string;
  ownerKey: string;
  exportedAt: string;
}

export interface ParsedOwnerKit {
  workspaceId: string;
  ownerKey: string;
}

const MALFORMED = "This is not a Suite owner file. Choose the .suitekey file Suite saved.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Pretty JSON, ready to download or copy. */
export function createOwnerKit(
  workspaceId: string,
  ownerKey: string,
  exportedAt = new Date().toISOString(),
): string {
  const kit: OwnerKit = {
    kind: OWNER_KIT_KIND,
    version: OWNER_KIT_VERSION,
    workspaceId,
    ownerKey,
    exportedAt,
  };
  return JSON.stringify(kit, null, 2);
}

/**
 * Validates a `.suitekey` file. Every failure names the problem so the protected
 * screen can show it without a second explanation.
 */
export function parseOwnerKit(input: string): ParsedOwnerKit {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new Error(MALFORMED);
  }
  if (!isRecord(value)) throw new Error(MALFORMED);

  if (value.kind !== OWNER_KIT_KIND) {
    throw new Error(
      "This file is not a Suite owner file. A .suite workspace backup does not restore access.",
    );
  }

  const version = value.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new Error("This owner file is missing its version.");
  }
  if (version > OWNER_KIT_VERSION) {
    throw new Error(
      `This owner file was made by a newer Suite (version ${version}); this build supports ${OWNER_KIT_VERSION}.`,
    );
  }

  const workspaceId = text(value.workspaceId);
  if (workspaceId.length === 0) throw new Error("This owner file does not name a workspace.");

  const ownerKey = text(value.ownerKey);
  if (ownerKey.length === 0) throw new Error("This owner file does not contain an owner key.");

  if (text(value.exportedAt).length === 0) {
    throw new Error("This owner file is missing its export date.");
  }

  return { workspaceId, ownerKey };
}

/** Throws when a parsed kit belongs to another workspace. */
export function assertOwnerKitWorkspace(kit: ParsedOwnerKit, workspaceId: string): void {
  if (kit.workspaceId !== workspaceId) throw new Error(OWNER_KIT_MISMATCH);
}

/**
 * The one validation path for a key file's text. Screens that already know
 * which workspace they are opening pass it, so a key for another workspace is
 * refused before anything is written.
 */
export function readOwnerKit(text: string, expectedWorkspaceId?: string | null): ParsedOwnerKit {
  const kit = parseOwnerKit(text);
  if (expectedWorkspaceId) assertOwnerKitWorkspace(kit, expectedWorkspaceId);
  return kit;
}

/** Reads a chosen `.suitekey` file and validates it the same way. */
export async function readOwnerKitFile(
  file: File,
  expectedWorkspaceId?: string | null,
): Promise<ParsedOwnerKit> {
  return readOwnerKit(await file.text(), expectedWorkspaceId);
}

/**
 * Removes this browser's access to a workspace: the owner key, the download
 * flag, the recents entry and the cached document. The relay copy and every
 * share link stay as they are.
 */
export async function forgetBrowserWorkspace(workspaceId: string): Promise<void> {
  forgetOwnerKey(workspaceId);
  clearSavedRecoveryKey(workspaceId);
  forgetWorkspace(workspaceId);
  try {
    await deleteWorkspaceDocument(workspaceId);
  } catch {
    // A browser without IndexedDB still forgets the key, which is the authority.
  }
}

/** `<stem>-recovery.suitekey`: a name that cannot be mistaken for a backup. */
export function ownerKitFilename(title = "workspace"): string {
  return `${fileStem(title)}-recovery${OWNER_KIT_EXTENSION}`;
}

/**
 * Downloads the recovery file. It is JSON, not a zip, so a person can read what
 * it is before trusting it with their workspace.
 */
export function downloadOwnerKit(
  workspaceId: string,
  ownerKey: string,
  title = "workspace",
): string {
  const filename = ownerKitFilename(title);
  downloadText(filename, createOwnerKit(workspaceId, ownerKey), "application/json");
  markRecoveryKeySaved(workspaceId);
  return filename;
}
