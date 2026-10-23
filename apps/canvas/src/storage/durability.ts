import { create } from "zustand";

/**
 * Client storage honesty.
 *
 * The browser can evict this tab's whole document, and a save can fail because
 * the origin ran out of quota. Alpha does not hide either: the storage panel
 * shows the grant state and the estimate, and a refused write raises a visible
 * state instead of a silent one. The in-memory document is untouched by a
 * failed write — persistence is a side channel, never the source of truth.
 */

/** What the browser said about durable storage. */
export type PersistState = "unknown" | "persisted" | "denied" | "unsupported";

export interface StorageEstimate {
  usage: number | null;
  quota: number | null;
}

export interface QuotaFailure {
  message: string;
  at: number;
}

interface DurabilityState {
  persist: PersistState;
  /** True once `persist()` has been asked, granted or not. */
  requested: boolean;
  estimate: StorageEstimate;
  /** Set when a write was refused for quota; cleared by the next good write. */
  quota: QuotaFailure | null;
  setPersist: (state: PersistState) => void;
  setEstimate: (estimate: StorageEstimate) => void;
  noteQuotaExceeded: (message: string) => void;
  clearQuota: () => void;
  reset: () => void;
}

export const useDurabilityStore = create<DurabilityState>((set) => ({
  persist: "unknown",
  requested: false,
  estimate: { usage: null, quota: null },
  quota: null,
  setPersist: (persist) => set({ persist, requested: true }),
  setEstimate: (estimate) => set({ estimate }),
  noteQuotaExceeded: (message) => set({ quota: { message, at: Date.now() } }),
  clearQuota: () => set({ quota: null }),
  reset: () =>
    set({
      persist: "unknown",
      requested: false,
      estimate: { usage: null, quota: null },
      quota: null,
    }),
}));

/** Names a browser uses for "this origin is out of disk". */
const QUOTA_ERROR_NAMES = new Set(["QuotaExceededError", "NS_ERROR_DOM_QUOTA_REACHED"]);

export function isQuotaExceeded(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const named = error as { name?: unknown; code?: unknown; cause?: unknown };
  if (typeof named.name === "string" && QUOTA_ERROR_NAMES.has(named.name)) return true;
  // Safari and older WebKit report 22, Firefox 1014.
  if (named.code === 22 || named.code === 1014) return true;
  return isQuotaExceeded(named.cause);
}

export function classifyStorageError(error: unknown): "quota" | "other" {
  return isQuotaExceeded(error) ? "quota" : "other";
}

/**
 * Asks for durable storage once. Called after the first meaningful interaction,
 * because Chrome only grants it to an origin the user has actually used.
 *
 * `false` is a refusal, not a failure: the document still saves, but the
 * browser may evict it, so the panel says so and offers an export.
 */
export async function requestPersistence(
  storage: Pick<StorageManager, "persist" | "persisted"> | undefined = globalThis.navigator
    ?.storage,
): Promise<PersistState> {
  const store = useDurabilityStore.getState();
  if (!storage || typeof storage.persist !== "function") {
    store.setPersist("unsupported");
    return "unsupported";
  }
  try {
    const granted = await storage.persist();
    const state: PersistState = granted ? "persisted" : "denied";
    store.setPersist(state);
    return state;
  } catch {
    // A browser that throws here still stores data; it just cannot promise to
    // keep it. `denied` would overstate what happened.
    store.setPersist("unsupported");
    return "unsupported";
  }
}

/** Reads `navigator.storage.estimate()` into the panel's state. */
export async function refreshEstimate(
  storage: Pick<StorageManager, "estimate"> | undefined = globalThis.navigator?.storage,
): Promise<StorageEstimate> {
  if (!storage || typeof storage.estimate !== "function") {
    const empty = { usage: null, quota: null };
    useDurabilityStore.getState().setEstimate(empty);
    return empty;
  }
  try {
    const { usage, quota } = await storage.estimate();
    const estimate = {
      usage: typeof usage === "number" ? usage : null,
      quota: typeof quota === "number" ? quota : null,
    };
    useDurabilityStore.getState().setEstimate(estimate);
    return estimate;
  } catch {
    const empty = { usage: null, quota: null };
    useDurabilityStore.getState().setEstimate(empty);
    return empty;
  }
}

type WriteMethod = (this: unknown, ...args: unknown[]) => IDBRequest;

function noteFailure(error: unknown): void {
  if (!isQuotaExceeded(error)) return;
  useDurabilityStore
    .getState()
    .noteQuotaExceeded(
      "This browser is out of storage, so the latest change could not be saved to this device. " +
        "It is still in this tab; export a copy before closing it.",
    );
}

/**
 * Wraps IndexedDB's write methods so a refused write becomes visible state.
 *
 * Exported separately from the installer so it can be tested without a browser:
 * the interesting part is the classification, not the patch.
 */
export function instrumentWriteMethods(
  methods: { add: WriteMethod; put: WriteMethod },
  onQuota: (error: unknown) => void,
): () => void {
  const originals = { add: methods.add, put: methods.put };
  for (const name of ["add", "put"] as const) {
    const original = originals[name];
    methods[name] = function patched(this: unknown, ...args: unknown[]) {
      const request = original.apply(this, args);
      // The request error carries the name; the transaction abort carries it too
      // when the request has no handler of its own.
      request?.addEventListener?.("error", () => {
        if (isQuotaExceeded(request.error)) onQuota(request.error);
      });
      return request;
    };
  }
  return () => {
    methods.add = originals.add;
    methods.put = originals.put;
  };
}

let uninstall: (() => void) | null = null;

/**
 * Installs the quota guard on this page's IndexedDB. Idempotent, and a no-op
 * where IndexedDB (or its prototype) is unavailable, such as a share viewer in a
 * browser with storage blocked.
 */
export function installIndexedDbQuotaGuard(
  prototype: IDBObjectStore | undefined = typeof IDBObjectStore === "undefined"
    ? undefined
    : IDBObjectStore.prototype,
): void {
  if (uninstall || !prototype) return;
  uninstall = instrumentWriteMethods(
    prototype as unknown as {
      add: WriteMethod;
      put: WriteMethod;
    },
    noteFailure,
  );
}

export function uninstallIndexedDbQuotaGuard(): void {
  uninstall?.();
  uninstall = null;
}

/**
 * Asks for persistence on the first real change to the document — an edit, an
 * import, a move — never on load. Returns the unsubscribe function.
 */
export function persistAfterFirstEdit(doc: {
  subscribeLocalUpdates: (fn: () => void) => () => void;
}): () => void {
  if (useDurabilityStore.getState().requested) return () => {};
  let done = false;
  const unsubscribe = doc.subscribeLocalUpdates(() => {
    if (done) return;
    done = true;
    void requestPersistence().then(() => refreshEstimate());
    unsubscribe();
  });
  return unsubscribe;
}

/** Test seam: drops the installed guard and every piece of state it feeds. */
export function resetDurabilityForTests(): void {
  uninstallIndexedDbQuotaGuard();
  useDurabilityStore.getState().reset();
}

/** `12.3 MB of 60 GB` — or a plain "unknown" when the browser will not say. */
export function formatEstimate(estimate: StorageEstimate): string {
  if (estimate.usage === null) return "unknown";
  const used = formatBytes(estimate.usage);
  return estimate.quota === null ? `${used} used` : `${used} of ${formatBytes(estimate.quota)}`;
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}
