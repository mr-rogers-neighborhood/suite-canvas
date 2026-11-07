import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type DeviceGroup, decodeGroup, encodeGroup } from "@suite/sync";

/**
 * A device's MLS group state, per workspace, on disk.
 *
 * Losing this file is losing the ability to read the workspace: the group secret it holds
 * cannot be derived again from anything else this app has. That is why the recovery kit
 * exists, and why this writes through a temporary file — a half-written group is not a
 * group, and a crash should leave the previous one intact.
 */
export async function loadGroup(dataDir: string, workspaceId: string): Promise<DeviceGroup | null> {
  try {
    return decodeGroup(new Uint8Array(await readFile(pathFor(dataDir, workspaceId))));
  } catch {
    return null;
  }
}

export async function saveGroup(
  dataDir: string,
  workspaceId: string,
  group: DeviceGroup,
): Promise<void> {
  const directory = directoryFor(dataDir);
  await mkdir(directory, { recursive: true });
  const target = pathFor(dataDir, workspaceId);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, encodeGroup(group), { mode: 0o600 });
  await rename(temporary, target);
}

/**
 * Whether this device started this workspace's group, rather than being added to it.
 *
 * It decides one thing: who may claim ownership when the host has no owner on record. A
 * device that was let in must never be able to make that claim, whatever the host has
 * forgotten, so the answer is written once at creation and read back from disk.
 */
export async function markOwned(dataDir: string, workspaceId: string): Promise<void> {
  await mkdir(directoryFor(dataDir), { recursive: true });
  await writeFile(markerFor(dataDir, workspaceId), "owned\n", { mode: 0o600 });
}

export async function isOwned(dataDir: string, workspaceId: string): Promise<boolean> {
  try {
    await readFile(markerFor(dataDir, workspaceId));
    return true;
  } catch {
    return false;
  }
}

function markerFor(dataDir: string, workspaceId: string): string {
  return join(directoryFor(dataDir), `${workspaceId}.owner`);
}

function directoryFor(dataDir: string): string {
  return join(dataDir, "sync", "groups");
}

function pathFor(dataDir: string, workspaceId: string): string {
  return join(directoryFor(dataDir), `${workspaceId}.mls`);
}
