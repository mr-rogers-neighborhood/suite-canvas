/**
 * The owner recovery kit: a small JSON file holding the owner key, deliberately
 * separate from a `.suite` backup. A document backup is copied, attached and
 * shared for debugging; a key inside it would silently hand over ownership, so
 * recovery lives in its own `.suitekey` file.
 */

import { downloadText, fileStem } from "./workspaceTransfer";

export const OWNER_KIT_KIND = "suite.owner";
export const OWNER_KIT_VERSION = 1;
export const OWNER_KIT_EXTENSION = ".suitekey";
const RECOVERY_SAVED_PREFIX = "suite.recoverySaved.";

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/** True when this browser has downloaded a recovery key for the workspace. */
export function hasSavedRecoveryKey(workspaceId: string): boolean {
  if (!hasStorage()) return false;
  try {
    return window.localStorage.getItem(`${RECOVERY_SAVED_PREFIX}${workspaceId}`) === "1";
  } catch {
    return false;
  }
}

function markRecoveryKeySaved(workspaceId: string): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(`${RECOVERY_SAVED_PREFIX}${workspaceId}`, "1");
  } catch {
    // Convenience flag only; a full storage must not block the download.
  }
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

const MALFORMED = "This is not a Suite recovery key. Choose the .suitekey file Suite saved.";
const MISMATCH = "That recovery key does not own this workspace.";

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
      "This file is not a Suite recovery key. A .suite workspace backup does not restore access.",
    );
  }

  const version = value.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new Error("This recovery key is missing its version.");
  }
  if (version > OWNER_KIT_VERSION) {
    throw new Error(
      `This recovery key was made by a newer Suite (version ${version}); this build supports ${OWNER_KIT_VERSION}.`,
    );
  }

  const workspaceId = text(value.workspaceId);
  if (workspaceId.length === 0) throw new Error("This recovery key does not name a workspace.");

  const ownerKey = text(value.ownerKey);
  if (ownerKey.length === 0) throw new Error("This recovery key does not contain an owner key.");

  if (text(value.exportedAt).length === 0) {
    throw new Error("This recovery key is missing its export date.");
  }

  return { workspaceId, ownerKey };
}

/** Throws when a parsed kit belongs to another workspace. */
export function assertOwnerKitWorkspace(kit: ParsedOwnerKit, workspaceId: string): void {
  if (kit.workspaceId !== workspaceId) throw new Error(MISMATCH);
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
