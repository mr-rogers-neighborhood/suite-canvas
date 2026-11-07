import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  mergeKitReports,
  SUITE_SYNC_KITS_FILE,
  SUITE_SYNC_KITS_FORMAT,
  type SuiteSyncKits,
  type SyncKitReport,
  type SyncKitState,
} from "@suite/contracts";

/**
 * What this app says about its way back in, for the hub to read.
 *
 * The hub is the only surface that can see every app on the machine, and it cannot look inside
 * one — so an app reports instead: made, or declined, per workspace. A report rather than a
 * command, like `update-state`: nothing here makes anything happen, and a stale row is visible
 * as a stale `at`.
 */
export interface KitFact {
  readonly workspaceId: string;
  readonly deviceId: string;
  readonly state: SyncKitState;
  readonly sealed: boolean;
}

export async function recordKit(dataDir: string, fact: KitFact, now = new Date()): Promise<void> {
  const path = join(dataDir, SUITE_SYNC_KITS_FILE);
  const existing = await read(dataDir);
  const reports = mergeKitReports(existing, [{ ...fact, at: now.toISOString() }]);
  const report: SuiteSyncKits = {
    format: SUITE_SYNC_KITS_FORMAT,
    updatedAt: now.toISOString(),
    kits: reports,
  };

  await mkdir(dataDir, { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
  await rename(temporary, path);
}

/** What this app has already said, so the dialog can stop asking after a decline. */
export async function readKits(dataDir: string): Promise<readonly SyncKitReport[]> {
  return read(dataDir);
}

/** The row for one workspace and this device, when there is one. */
export async function kitFactFor(
  dataDir: string,
  workspaceId: string,
  deviceId: string,
): Promise<SyncKitReport | null> {
  const rows = await read(dataDir);
  return rows.find((row) => row.workspaceId === workspaceId && row.deviceId === deviceId) ?? null;
}

async function read(dataDir: string): Promise<readonly SyncKitReport[]> {
  try {
    const parsed = JSON.parse(await readFile(join(dataDir, SUITE_SYNC_KITS_FILE), "utf8")) as {
      format?: unknown;
      kits?: unknown;
    };
    if (parsed.format !== SUITE_SYNC_KITS_FORMAT || !Array.isArray(parsed.kits)) return [];
    return parsed.kits as readonly SyncKitReport[];
  } catch {
    return [];
  }
}
