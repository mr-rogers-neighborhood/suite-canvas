/**
 * The shell's own state, remembered across a reload — and *only* the shell's.
 *
 * The document is the source of truth for everything the workspace holds, so
 * nothing here may stand in for it: no selection, no board or card positions,
 * no camera (the camera belongs to the View, so it is written through
 * `WorkspaceDocument.setViewCamera`), no filters or saved query (they name ids
 * the document owns and can go stale the moment a peer deletes a type).
 *
 * What is left is what a reader expects the shell to remember: which card the
 * inspector was showing, whether the library drawer was open and on which tab,
 * and which cards were expanded. The allow-list below is the whole contract —
 * a key that is not named there is never written, and the unit test beside this
 * module fails if that list changes without someone deciding it should.
 *
 * Display style in the other sense — the field and mention templates edited by
 * `DisplayStyleDialog` — is document data (a field's `display` and a card's
 * overrides), so it is deliberately absent here. The app's light/dark mode has
 * its own store (`useThemeStore`) and its own key.
 *
 * Writes are throttled: the store changes on pointer moves (hover, marquee),
 * and a synchronous `localStorage` write per change would be a frame cost.
 */

import { useUiStore } from "./useUiStore";

/** The keys this module is allowed to carry. Add an entry only with a reason. */
export const PERSISTED_UI_KEYS = [
  /** Which card the inspector is showing — the subject, not the selection. */
  "inspectorNodeId",
  /** The library drawer, and the tab it was left on. */
  "libraryOpen",
  "libraryTab",
  /** Cards whose frontmatter is expanded: a reading preference, per card. */
  "expandedCardMeta",
] as const;

export type PersistedUiKey = (typeof PERSISTED_UI_KEYS)[number];

/** The shell state a reload restores. */
export type PersistedUiState = Pick<UiStateOfStore, PersistedUiKey>;

/** `useUiStore`'s state, without importing its private interface by name. */
type UiStateOfStore = ReturnType<typeof useUiStore.getState>;

/** Storage keys are per workspace: a card id from one must not reach another. */
export const UI_STORAGE_PREFIX = "suite.ui.v1:";
const WRITE_DELAY_MS = 250;

const LIBRARY_TABS: readonly string[] = ["inbox", "cards", "pins", "trash"];

export type PersistedStorage = Pick<Storage, "getItem" | "setItem">;

function storageOf(): PersistedStorage | null {
  try {
    if (typeof window === "undefined" || window.localStorage === undefined) return null;
    return window.localStorage;
  } catch {
    // A browser with storage disabled throws on the property itself.
    return null;
  }
}

export function uiStorageKey(scope: string): string {
  return `${UI_STORAGE_PREFIX}${scope}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only the allow-listed slice, so a write can never leak document state. */
export function persistedUiSlice(state: UiStateOfStore): PersistedUiState {
  return {
    inspectorNodeId: state.inspectorNodeId,
    libraryOpen: state.libraryOpen,
    libraryTab: state.libraryTab,
    expandedCardMeta: state.expandedCardMeta,
  };
}

/**
 * Read a stored slice, keeping only values this build knows how to use. A key
 * that fails validation is dropped rather than trusted: a stale or hand-edited
 * entry must never put the shell into a state the store cannot represent.
 */
export function parsePersistedUi(raw: string | null | undefined): Partial<PersistedUiState> {
  if (raw === null || raw === undefined || raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};
  const slice: Partial<PersistedUiState> = {};
  const inspector = parsed.inspectorNodeId;
  if (inspector === null || typeof inspector === "string") {
    slice.inspectorNodeId = inspector;
  }
  if (typeof parsed.libraryOpen === "boolean") slice.libraryOpen = parsed.libraryOpen;
  if (typeof parsed.libraryTab === "string" && LIBRARY_TABS.includes(parsed.libraryTab)) {
    slice.libraryTab = parsed.libraryTab as PersistedUiState["libraryTab"];
  }
  if (isRecord(parsed.expandedCardMeta)) {
    const expanded: Record<string, boolean> = {};
    for (const [cardId, open] of Object.entries(parsed.expandedCardMeta)) {
      if (cardId.length > 0 && typeof open === "boolean") expanded[cardId] = open;
    }
    slice.expandedCardMeta = expanded;
  }
  return slice;
}

/**
 * Apply the stored shell state. Called once, during the shell's first render,
 * so a reload does not paint the defaults and then correct them.
 */
export function hydratePersistedUi(
  scope: string,
  storage: PersistedStorage | null = storageOf(),
): boolean {
  if (storage === null) return false;
  let raw: string | null = null;
  try {
    raw = storage.getItem(uiStorageKey(scope));
  } catch {
    return false;
  }
  const slice = parsePersistedUi(raw);
  if (Object.keys(slice).length === 0) return false;
  useUiStore.setState(slice);
  return true;
}

/**
 * Follow the store and remember the allow-listed slice. Returns the detach
 * function, so a workspace change does not leave a second writer behind.
 */
export function startPersistedUi(
  scope: string,
  storage: PersistedStorage | null = storageOf(),
): () => void {
  if (storage === null) return () => {};
  const key = uiStorageKey(scope);
  let last = "";
  try {
    last = storage.getItem(key) ?? "";
  } catch {
    last = "";
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = (): void => {
    timer = undefined;
    const serialized = JSON.stringify(persistedUiSlice(useUiStore.getState()));
    if (serialized === last) return;
    last = serialized;
    try {
      storage.setItem(key, serialized);
    } catch {
      // A full or denied store costs the next session's convenience, not this
      // one's work: the document is elsewhere.
    }
  };
  const unsubscribe = useUiStore.subscribe(() => {
    // Throttle, not debounce: the first change in a window is already the one
    // that matters, and a drag keeps a debounce from ever firing.
    if (timer !== undefined) return;
    timer = setTimeout(flush, WRITE_DELAY_MS);
  });
  return () => {
    unsubscribe();
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
      flush();
    }
  };
}
