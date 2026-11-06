import { isMemberId, isWorkspaceId } from "@suite/sync";

/**
 * The dev sync configuration, read from the page URL.
 *
 * A real app gets this from the shell or a settings surface; this phase uses
 * query parameters so two windows can be pointed at one `suite-sync` server
 * without adding a panel. `syncWorkspace` is the 64-hex server room, which may
 * differ from the local document id when the app's id is not a fingerprint.
 */
export interface SuiteSyncConfig {
  readonly url: string;
  readonly workspaceId: string;
  readonly memberId: string;
  readonly deviceId: string;
  readonly epoch: number;
}

export type SuiteSyncConfigRead =
  | { readonly ok: true; readonly value: SuiteSyncConfig }
  | { readonly ok: false; readonly error: string }
  | null;

/** The app rewrites its URL to the board; the dev config has to survive that. */
const CACHE_KEY = "suite.sync.config.v1";

export function readSuiteSyncConfig(
  defaultWorkspaceId: string | null,
  search: string = typeof window === "undefined" ? "" : window.location.search,
): SuiteSyncConfigRead {
  const params = new URLSearchParams(search);
  const keys = ["syncUrl", "member", "epoch", "syncWorkspace", "device"];
  if (!keys.some((key) => params.has(key))) return readCache();

  const url = params.get("syncUrl")?.trim() ?? "";
  if (!/^wss?:\/\//u.test(url)) {
    return { ok: false, error: "syncUrl must be a ws:// or wss:// URL" };
  }

  const memberId = params.get("member")?.trim() ?? "";
  if (!isMemberId(memberId)) {
    return { ok: false, error: "member must be 64 lower-case hex characters" };
  }

  const workspaceId = params.get("syncWorkspace")?.trim() || defaultWorkspaceId || "";
  if (!isWorkspaceId(workspaceId)) {
    return {
      ok: false,
      error: "syncWorkspace must be 64 lower-case hex characters",
    };
  }

  const deviceId = params.get("device")?.trim() || memberId;
  if (!isMemberId(deviceId)) {
    return { ok: false, error: "device must be 64 lower-case hex characters" };
  }

  const epochText = params.get("epoch")?.trim() ?? "1";
  const epoch = Number(epochText);
  if (!Number.isInteger(epoch) || epoch <= 0) {
    return { ok: false, error: "epoch must be a positive integer" };
  }

  const value = { url, workspaceId, memberId, deviceId, epoch };
  writeCache(value);
  return { ok: true, value };
}

function readCache(): SuiteSyncConfigRead {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (raw === null) return null;
    const parsed = parseCached(JSON.parse(raw));
    return parsed === null ? null : { ok: true, value: parsed };
  } catch {
    return null;
  }
}

function writeCache(value: SuiteSyncConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    // A disabled storage is not a reason to lose the in-memory config.
  }
}

function parseCached(value: unknown): SuiteSyncConfig | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.url !== "string" || record.url.length === 0) return null;
  if (typeof record.workspaceId !== "string" || !isWorkspaceId(record.workspaceId)) return null;
  if (typeof record.memberId !== "string" || !isMemberId(record.memberId)) return null;
  if (typeof record.deviceId !== "string" || !isMemberId(record.deviceId)) return null;
  if (typeof record.epoch !== "number" || !Number.isInteger(record.epoch)) return null;
  return {
    url: record.url,
    workspaceId: record.workspaceId,
    memberId: record.memberId,
    deviceId: record.deviceId,
    epoch: record.epoch,
  };
}
