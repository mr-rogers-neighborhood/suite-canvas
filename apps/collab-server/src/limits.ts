import { HttpError } from "./http.js";
import type { Logger } from "./logging.js";
import type { StoredDocument } from "./persistence.js";
import { SHARE_ROOM_PREFIX, type ShareStore } from "./shares.js";

/**
 * Quotas that are enforced, visible and tunable.
 *
 * The rule that shapes every refusal here: a save is never dropped. A workspace
 * over its document budget keeps loading and saving for its owner; it loses the
 * ability to mint new share links, and its next status call says why. Only the
 * boundaries where nothing has been written yet — a new workspace, a new share
 * link — are refused outright.
 */

/** Bytes, so the defaults below read as sizes rather than magic numbers. */
const KIB = 1024;
const MIB = 1024 * KIB;
const GIB = 1024 * MIB;

/**
 * Every limit is a count of bytes, workspaces, links or cards. `Infinity` means
 * unlimited and is serialized as `null` in JSON.
 */
export interface Limits {
  /** Workspaces one licence (hosted) or one instance (self-host) may hold. */
  maxWorkspaces: number;
  /** Stored document bytes a workspace may reach before it is marked over quota. */
  documentBytesPerWorkspace: number;
  /** Bytes of one workspace's active share projections. */
  projectionBytesPerWorkspace: number;
  /** Reserved for attachments; nothing stores attachments yet. */
  attachmentBytesPerWorkspace: number;
  /** Active share links per workspace. */
  sharesPerWorkspace: number;
  /** Cards one selection share may include. */
  selectionCards: number;
  /** Document-store size at which new workspaces are allowed but logged. */
  diskSoftBytes: number;
  /** Document-store size at which new workspaces are refused. */
  diskHardBytes: number;
}

export type LimitKey = keyof Limits;

/** Fixed order, so admin responses and `limitsProblem` reports read the same way. */
export const LIMIT_KEYS = [
  "maxWorkspaces",
  "documentBytesPerWorkspace",
  "projectionBytesPerWorkspace",
  "attachmentBytesPerWorkspace",
  "sharesPerWorkspace",
  "selectionCards",
  "diskSoftBytes",
  "diskHardBytes",
] as const satisfies readonly LimitKey[];

/** Environment variable behind each limit. The docs table mirrors this map. */
export const LIMIT_ENV = {
  maxWorkspaces: "SUITE_MAX_WORKSPACES",
  documentBytesPerWorkspace: "SUITE_DOCUMENT_BYTES_PER_WORKSPACE",
  projectionBytesPerWorkspace: "SUITE_PROJECTION_BYTES_PER_WORKSPACE",
  attachmentBytesPerWorkspace: "SUITE_ATTACHMENT_BYTES_PER_WORKSPACE",
  sharesPerWorkspace: "SUITE_MAX_SHARES_PER_WORKSPACE",
  selectionCards: "SUITE_MAX_SELECTION_CARDS",
  diskSoftBytes: "SUITE_DISK_SOFT_BYTES",
  diskHardBytes: "SUITE_DISK_HARD_BYTES",
} as const satisfies Record<LimitKey, string>;

/**
 * Self-host defaults. Storage quotas are unlimited: the project ships with
 * feature parity and no licence, so nothing is capped unless an operator asks
 * for it. The two interaction caps are the ones already enforced — 100 links
 * and 200 cards per selection.
 */
export const SELF_HOSTED_DEFAULTS: Limits = {
  maxWorkspaces: Number.POSITIVE_INFINITY,
  documentBytesPerWorkspace: Number.POSITIVE_INFINITY,
  projectionBytesPerWorkspace: Number.POSITIVE_INFINITY,
  attachmentBytesPerWorkspace: Number.POSITIVE_INFINITY,
  sharesPerWorkspace: 100,
  selectionCards: 200,
  diskSoftBytes: Number.POSITIVE_INFINITY,
  diskHardBytes: Number.POSITIVE_INFINITY,
};

/**
 * Hosted defaults. The licence carries `workspaces` and `documentBytes`, so the
 * per-licence caps still come from the signed token; these are the instance
 * guardrails that keep one relay from filling its own disk.
 */
export const HOSTED_DEFAULTS: Limits = {
  ...SELF_HOSTED_DEFAULTS,
  projectionBytesPerWorkspace: 32 * MIB,
  diskSoftBytes: 4 * GIB,
  diskHardBytes: 5 * GIB,
};

/** Build-in defaults for one mode. `SUITE_HOSTED=1` selects the hosted set. */
export function defaultLimits(hosted: boolean): Limits {
  return hosted ? { ...HOSTED_DEFAULTS } : { ...SELF_HOSTED_DEFAULTS };
}

/** Where one effective value came from, in the order they are merged. */
export type LimitSource = "default" | "env" | "override";

export interface ResolvedLimits {
  limits: Limits;
  sources: Record<LimitKey, LimitSource>;
  /** Values that were rejected while resolving; boot logs them and stops. */
  problems: string[];
}

export type LimitEnv = Readonly<Record<string, string | undefined>>;

export type LimitOverrides = Partial<Record<LimitKey, number>>;

/**
 * Merges built-in defaults ← `SUITE_*` environment variables ← runtime
 * overrides from the settings store, in that order. An unreadable value is
 * reported in `problems` and the layer below it wins, so one typo cannot make
 * the server enforce a quota nobody asked for.
 */
export function resolveLimits(
  env: LimitEnv = process.env,
  overrides: LimitOverrides | null = null,
): ResolvedLimits {
  const limits = defaultLimits(env.SUITE_HOSTED === "1");
  const sources = {} as Record<LimitKey, LimitSource>;
  for (const key of LIMIT_KEYS) sources[key] = "default";

  const problems: string[] = [];
  for (const key of LIMIT_KEYS) {
    const raw = env[LIMIT_ENV[key]];
    if (raw === undefined || raw.trim().length === 0) continue;
    const parsed = parseLimitText(raw);
    if (parsed.problem !== null) {
      problems.push(parsed.problem.replace("$VAR", LIMIT_ENV[key]));
      continue;
    }
    limits[key] = parsed.value;
    sources[key] = "env";
  }

  for (const key of LIMIT_KEYS) {
    const value = overrides?.[key];
    if (value === undefined) continue;
    if (!isLimitValue(value)) {
      problems.push(`The override for ${key} is not a whole number: ${String(value)}.`);
      continue;
    }
    limits[key] = value;
    sources[key] = "override";
  }

  return { limits, sources, problems };
}

function isLimitValue(value: unknown): value is number {
  return (
    typeof value === "number" &&
    !Number.isNaN(value) &&
    value >= 0 &&
    (Number.isInteger(value) || value === Number.POSITIVE_INFINITY)
  );
}

const UNLIMITED_TEXT = new Set(["unlimited", "infinity", "none"]);

function parseLimitText(
  raw: string,
): { value: number; problem: null } | { value: 0; problem: string } {
  const text = raw.trim().toLowerCase();
  if (UNLIMITED_TEXT.has(text)) return { value: Number.POSITIVE_INFINITY, problem: null };
  if (!/^\d+$/.test(text)) {
    return {
      value: 0,
      problem: `$VAR must be a whole number of bytes or "unlimited", got "${raw}".`,
    };
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    return { value: 0, problem: `$VAR is too large: "${raw}".` };
  }
  return { value, problem: null };
}

/**
 * Explains why a resolved configuration cannot be enforced, or null when it is
 * coherent. Boot fails fast on this so a contradiction is a startup error, not
 * a quota that silently never fires.
 */
export function limitsProblem(limits: Limits): string | null {
  for (const key of LIMIT_KEYS) {
    if (!isLimitValue(limits[key])) {
      return `The ${key} limit must be a whole number of bytes or "unlimited", got ${String(limits[key])}.`;
    }
  }
  if (limits.diskSoftBytes > limits.diskHardBytes) {
    return `The disk soft watermark (${formatBytes(limits.diskSoftBytes)}) is above the hard watermark (${formatBytes(limits.diskHardBytes)}); the warning could never fire.`;
  }
  return null;
}

/** Bytes as an operator reads them; `Infinity` is "unlimited". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "unlimited";
  const value = Math.max(0, Math.round(bytes));
  if (value < KIB) return `${value} B`;
  if (value < MIB) return `${trimZero(value / KIB)} KiB`;
  if (value < GIB) return `${trimZero(value / MIB)} MiB`;
  return `${trimZero(value / GIB)} GiB`;
}

function trimZero(value: number): string {
  return value >= 100 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
}

/** JSON shape of the limits: `Infinity` has no JSON number, so it becomes null. */
export function publicLimits(limits: Limits): Record<LimitKey, number | null> {
  const out = {} as Record<LimitKey, number | null>;
  for (const key of LIMIT_KEYS) {
    out[key] = Number.isFinite(limits[key]) ? limits[key] : null;
  }
  return out;
}

/* --------------------------------- overrides --------------------------------- */

/** Key under which runtime overrides live in the settings store. */
export const LIMIT_OVERRIDES_KEY = "limits.overrides";

/** The slice of the settings store the limits code needs. */
export interface KeyValueStore {
  get: (key: string) => string | null;
  set: (key: string, value: string | null) => void;
}

export interface ParsedLimitOverrides {
  /** Values to write; null removes an override. */
  changes: Partial<Record<LimitKey, number | null>>;
  problem: string | null;
}

/**
 * Validates a `PUT /api/admin/limits` body. Only known limit keys are accepted,
 * so a typo is an error instead of a key nobody reads.
 */
export function parseLimitOverrides(value: unknown): ParsedLimitOverrides {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { changes: {}, problem: "Limit overrides must be a JSON object." };
  }
  const changes: Partial<Record<LimitKey, number | null>> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!(LIMIT_KEYS as readonly string[]).includes(key)) {
      return {
        changes: {},
        problem: `Unknown limit "${key}". Known limits: ${LIMIT_KEYS.join(", ")}.`,
      };
    }
    const limit = key as LimitKey;
    if (raw === null) {
      changes[limit] = null;
      continue;
    }
    if (typeof raw === "string" && UNLIMITED_TEXT.has(raw.trim().toLowerCase())) {
      changes[limit] = Number.POSITIVE_INFINITY;
      continue;
    }
    if (!isLimitValue(raw)) {
      return {
        changes: {},
        problem: `${key} must be a whole number of bytes, "unlimited", or null to clear it.`,
      };
    }
    changes[limit] = raw;
  }
  return { changes, problem: null };
}

/** Runtime overrides persisted by the admin API; a corrupt row reads as none. */
export function readLimitOverrides(store: KeyValueStore): LimitOverrides {
  const raw = store.get(LIMIT_OVERRIDES_KEY);
  if (raw === null || raw.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  const { changes, problem } = parseLimitOverrides(parsed);
  if (problem !== null) return {};
  const overrides: LimitOverrides = {};
  for (const [key, value] of Object.entries(changes)) {
    if (typeof value === "number") overrides[key as LimitKey] = value;
  }
  return overrides;
}

/** Persists overrides; `Infinity` is stored as "unlimited" so JSON keeps it. */
export function writeLimitOverrides(store: KeyValueStore, overrides: LimitOverrides): void {
  const stored: Record<string, number | string> = {};
  for (const key of LIMIT_KEYS) {
    const value = overrides[key];
    if (value === undefined) continue;
    stored[key] = Number.isFinite(value) ? value : "unlimited";
  }
  store.set(LIMIT_OVERRIDES_KEY, Object.keys(stored).length === 0 ? null : JSON.stringify(stored));
}

/* ---------------------------------- usage ----------------------------------- */

/** The stored bytes of one workspace, and how many links it has. */
export interface WorkspaceUsage {
  documentBytes: number;
  projectionBytes: number;
  activeShares: number;
}

export interface UsageStores {
  /** Document inventory; a double without `list` reads as empty. */
  documents: { list?: () => readonly StoredDocument[] };
  shares: Pick<ShareStore, "list">;
}

/** Store keys are `<crdt type>:<room id>`; only the room id matters here. */
function roomIdOf(name: string): string | null {
  const separator = name.indexOf(":");
  if (separator <= 0) return null;
  const room = name.slice(separator + 1);
  return room.length > 0 ? room : null;
}

/**
 * Usage of several workspaces from one pass over the document inventory, so an
 * admin page does not scan the table once per row. A workspace share opens the
 * workspace room itself, so only `share-*` rooms count as projections.
 */
export function workspaceUsages(
  stores: UsageStores,
  workspaceIds: readonly string[],
): Map<string, WorkspaceUsage> {
  const usages = new Map<string, WorkspaceUsage>();
  for (const id of workspaceIds) {
    usages.set(id, { documentBytes: 0, projectionBytes: 0, activeShares: 0 });
  }

  const projectionRooms = new Map<string, string>();
  for (const id of workspaceIds) {
    let shares: readonly { roomId: string | null }[] = [];
    try {
      shares = stores.shares.list(id);
    } catch {
      shares = [];
    }
    const usage = usages.get(id);
    if (!usage) continue;
    usage.activeShares = shares.length;
    for (const share of shares) {
      if (share.roomId !== null && share.roomId !== id) projectionRooms.set(share.roomId, id);
    }
  }

  let documents: readonly StoredDocument[] = [];
  try {
    documents = stores.documents.list?.() ?? [];
  } catch {
    documents = [];
  }
  for (const entry of documents) {
    const room = roomIdOf(entry.name);
    if (room === null) continue;
    const usage = usages.get(room);
    if (usage) usage.documentBytes += entry.bytes;
    const owner = projectionRooms.get(room);
    if (owner !== undefined) {
      const ownerUsage = usages.get(owner);
      if (ownerUsage) ownerUsage.projectionBytes += entry.bytes;
    }
  }
  return usages;
}

/** Usage of one workspace. */
export function workspaceUsage(stores: UsageStores, workspaceId: string): WorkspaceUsage {
  const id = workspaceId.trim();
  return (
    workspaceUsages(stores, [id]).get(id) ?? {
      documentBytes: 0,
      projectionBytes: 0,
      activeShares: 0,
    }
  );
}

export interface WorkspaceQuota extends WorkspaceUsage {
  workspaceId: string;
  documentBudget: number;
  projectionBudget: number;
  /** True when the stored document is larger than its budget; saves still land. */
  overQuota: boolean;
  /** False when a new share link would be refused. */
  sharesAllowed: boolean;
}

export interface ShareBlock {
  status: number;
  message: string;
}

/**
 * Why a new share link is refused, or null when it may be created. The reason
 * and the current total are always in the message; none of these refusals can
 * lose an edit, because they happen before the link exists.
 */
export function shareBlockReason(
  quota: Pick<
    WorkspaceQuota,
    | "overQuota"
    | "documentBytes"
    | "documentBudget"
    | "projectionBytes"
    | "projectionBudget"
    | "activeShares"
  >,
  limits: Limits,
): ShareBlock | null {
  if (quota.overQuota) {
    return {
      status: 409,
      message: `New share links are paused: this workspace is over its document budget (${formatBytes(quota.documentBytes)} of ${formatBytes(quota.documentBudget)}). Your edits are still saved. Export the workspace, then remove content before sharing again.`,
    };
  }
  if (quota.projectionBytes >= quota.projectionBudget) {
    return {
      status: 507,
      message: `New share links are paused: this workspace's shared projections use ${formatBytes(quota.projectionBytes)} of a ${formatBytes(quota.projectionBudget)} budget. Your edits are still saved. Revoke a link or export the workspace.`,
    };
  }
  if (quota.activeShares >= limits.sharesPerWorkspace) {
    return {
      status: 409,
      message: `This workspace already has ${quota.activeShares} active links, its limit is ${limits.sharesPerWorkspace}. Revoke one before creating another.`,
    };
  }
  return null;
}

/* -------------------------------- the service ------------------------------- */

export interface QuotaOptions extends UsageStores {
  /** Effective limits, read on every call so a runtime override applies at once. */
  limits: () => Limits;
  /** Document-store size in bytes; `DocumentInventory.size`. */
  size?: () => number;
  /**
   * Per-workspace budget a hosted licence adds. Null when the licence adds
   * none; the tighter of the two always wins.
   */
  licenceBytes?: (
    workspaceId: string,
  ) => { documentBytes: number; projectionBytes?: number } | null;
  logger?: Logger;
  now?: () => number;
  /** How long a disk measurement is reused; one request batch by default. */
  diskTtlMs?: number;
}

export interface QuotaService {
  /** Effective limits, as merged from defaults, env and overrides. */
  limits: () => Limits;
  workspace: (workspaceId: string) => WorkspaceQuota;
  /** The document budget for one workspace, including any licence cap. */
  documentBudget: (workspaceId: string) => number;
  /** Document-store bytes, measured at most once per `diskTtlMs`. */
  disk: (options?: { fresh?: boolean }) => number;
  /** Logs the soft-watermark warning; the caller has already compared the marks. */
  noteSoftDisk: (limits: Limits) => void;
  /** Workspaces this instance already holds, derived from the document store. */
  instanceWorkspaces: () => number;
}

const DEFAULT_DISK_TTL_MS = 1000;

/**
 * One measurement of the document store reused across a request batch. The
 * store's `size()` is two PRAGMAs, not free, but a disk watermark does not need
 * per-call precision.
 */
export function createQuotaService(options: QuotaOptions): QuotaService {
  const clock = options.now ?? Date.now;
  const ttl = options.diskTtlMs ?? DEFAULT_DISK_TTL_MS;
  let measured: { at: number; bytes: number } | null = null;

  const disk = (opts?: { fresh?: boolean }): number => {
    const now = clock();
    if (!opts?.fresh && measured !== null && now - measured.at < ttl) return measured.bytes;
    let bytes = measured?.bytes ?? 0;
    try {
      bytes = options.size?.() ?? 0;
    } catch (error) {
      // A failed measurement must not refuse a save; keep the last reading.
      options.logger?.warn("could not measure the document store", {
        error: error instanceof Error ? error.message : String(error),
      });
      return bytes;
    }
    measured = { at: now, bytes };
    return bytes;
  };

  const documentBudget = (workspaceId: string): number => {
    const licence = options.licenceBytes?.(workspaceId.trim()) ?? null;
    return Math.min(
      options.limits().documentBytesPerWorkspace,
      licence?.documentBytes ?? Number.POSITIVE_INFINITY,
    );
  };

  const workspace = (workspaceId: string): WorkspaceQuota => {
    const id = workspaceId.trim();
    const limits = options.limits();
    const usage = workspaceUsage(options, id);
    const licence = options.licenceBytes?.(id) ?? null;
    const documentBudgetValue = documentBudget(id);
    const projectionBudget = Math.min(
      limits.projectionBytesPerWorkspace,
      licence?.projectionBytes ?? Number.POSITIVE_INFINITY,
    );
    const quota: WorkspaceQuota = {
      workspaceId: id,
      ...usage,
      documentBudget: documentBudgetValue,
      projectionBudget,
      overQuota: usage.documentBytes > documentBudgetValue,
      sharesAllowed: true,
    };
    quota.sharesAllowed = shareBlockReason(quota, limits) === null;
    return quota;
  };

  return {
    limits: options.limits,
    workspace,
    documentBudget,
    disk,
    noteSoftDisk: (limits) => {
      options.logger?.warn("document store above its soft watermark", {
        diskBytes: disk(),
        diskSoftBytes: limits.diskSoftBytes,
        diskHardBytes: limits.diskHardBytes,
      });
    },
    instanceWorkspaces: () => {
      const ids = new Set<string>();
      let documents: readonly StoredDocument[] = [];
      try {
        documents = options.documents.list?.() ?? [];
      } catch {
        documents = [];
      }
      for (const entry of documents) {
        const room = roomIdOf(entry.name);
        if (room !== null && !room.startsWith(SHARE_ROOM_PREFIX)) ids.add(room);
      }
      return ids.size;
    },
  };
}

/**
 * Wraps a share store so `create` consults the quotas first. Only creation is
 * guarded: reading, resolving and revoking a link never depends on a budget,
 * and the document store keeps saving whatever the quota says.
 */
export function createShareQuotaGuard(store: ShareStore, quotas: QuotaService): ShareStore {
  return {
    ...store,
    create: (input) => {
      const limits = quotas.limits();
      const selection = input.cardIds?.length ?? 0;
      if (selection > limits.selectionCards) {
        throw new HttpError(
          400,
          `A selection link can include at most ${limits.selectionCards} cards.`,
        );
      }
      const block = shareBlockReason(quotas.workspace(input.workspaceId), limits);
      if (block !== null) throw new HttpError(block.status, block.message);
      return store.create(input);
    },
  };
}
