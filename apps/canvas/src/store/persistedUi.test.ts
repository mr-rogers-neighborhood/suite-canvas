import { beforeEach, describe, expect, it } from "vitest";

import {
  hydratePersistedUi,
  PERSISTED_UI_KEYS,
  parsePersistedUi,
  persistedUiSlice,
  startPersistedUi,
  uiStorageKey,
} from "./persistedUi";
import { useUiStore } from "./useUiStore";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
    },
  };
}

beforeEach(() => {
  useUiStore.setState({
    inspectorNodeId: null,
    libraryOpen: false,
    libraryTab: "inbox",
    expandedCardMeta: {},
    selectedNodeIds: [],
    selectedEdgeIds: [],
    activeBoardId: null,
  });
});

describe("persisted shell UI", () => {
  it("should persist exactly the keys the shell means to remember", () => {
    // This is the allow-list contract: a new entry has to be a decision, and
    // changing it without thinking fails here.
    expect([...PERSISTED_UI_KEYS]).toEqual([
      "inspectorNodeId",
      "libraryOpen",
      "libraryTab",
      "expandedCardMeta",
    ]);
  });

  it("should never carry document truth", () => {
    const documentState = [
      "activeBoardId",
      "boardViewports",
      "boardHistory",
      "sceneFocusPath",
      "viewportRequest",
      "portalEntry",
      "selectedNodeIds",
      "selectedEdgeIds",
      "selectedSectionId",
      "focusTarget",
      "pendingPinFocus",
      "cardFocusId",
      "activeViewId",
      "libraryTypeFilter",
      "libraryTagFilter",
      "librarySectionFilter",
      "libraryQuery",
    ];
    for (const key of documentState) {
      expect(PERSISTED_UI_KEYS as readonly string[]).not.toContain(key);
    }
  });

  it("should write the allow-listed slice and nothing else", () => {
    const { map, storage } = memoryStorage();
    const stop = startPersistedUi("ws-1", storage);
    useUiStore.setState({
      libraryOpen: true,
      selectedNodeIds: ["card-9"],
      activeBoardId: "view-9",
    });
    stop();

    const written: unknown = JSON.parse(map.get(uiStorageKey("ws-1")) ?? "null");
    expect(written).toEqual({
      inspectorNodeId: null,
      libraryOpen: true,
      libraryTab: "inbox",
      expandedCardMeta: {},
    });
  });

  it("should restore the shell and leave the selection alone", () => {
    const { storage } = memoryStorage();
    const stop = startPersistedUi("ws-1", storage);
    useUiStore.setState({ libraryOpen: true, inspectorNodeId: "card-4" });
    stop();
    useUiStore.setState({ libraryOpen: false, inspectorNodeId: null });

    expect(hydratePersistedUi("ws-1", storage)).toBe(true);
    expect(useUiStore.getState().libraryOpen).toBe(true);
    expect(useUiStore.getState().inspectorNodeId).toBe("card-4");
    expect(useUiStore.getState().selectedNodeIds).toEqual([]);
  });

  it("should drop a stored value this build cannot use", () => {
    expect(parsePersistedUi("not json")).toEqual({});
    expect(parsePersistedUi(null)).toEqual({});
    expect(
      parsePersistedUi(
        JSON.stringify({
          libraryTab: "nope",
          libraryOpen: "yes",
          inspectorNodeId: 7,
          expandedCardMeta: { "card-1": true, "card-2": "expanded" },
        }),
      ),
    ).toEqual({ expandedCardMeta: { "card-1": true } });
  });

  it("should keep a slice to the allow-list even when the store holds more", () => {
    useUiStore.setState({ selectedNodeIds: ["card-1"], activeBoardId: "view-1" });

    expect(Object.keys(persistedUiSlice(useUiStore.getState())).sort()).toEqual(
      [...PERSISTED_UI_KEYS].sort(),
    );
  });

  it("should answer false when nothing is stored", () => {
    const { storage } = memoryStorage();
    expect(hydratePersistedUi("never-seen", storage)).toBe(false);
  });
});
