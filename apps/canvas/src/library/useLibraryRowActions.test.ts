import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "./libraryTypes";
import { useLibraryRowActions } from "./useLibraryRowActions";

const card: LibraryItem = {
  id: "card-1",
  title: "Receipt",
  boards: [],
  typeIds: ["note"],
  tagIds: [],
  sectionIds: [],
  properties: {},
};

function rowActions(overrides: { onDeleteForever?: (id: string) => void } = {}) {
  const onDeleteForever = vi.fn(overrides.onDeleteForever ?? (() => {}));
  const { result } = renderHook(() =>
    useLibraryRowActions({
      tab: "trash",
      ordered: [card],
      visibleBoards: [],
      activeBoardId: null,
      runActive: false,
      canManageTrash: true,
      onLocateCard: () => false,
      onLocateBoard: () => false,
      onOpenBoard: () => {},
      onPlaceBoard: () => {},
      onSetBoardTemplate: undefined,
      onUnplaceBoardCards: () => {},
      onRestore: () => {},
      onDeleteForever,
      onOpenCard: () => {},
      onGoToBoard: () => {},
      onPlace: () => {},
      onQueueCards: undefined,
      onTrash: () => {},
      setLocateMiss: () => {},
      setPendingDelete: () => {},
    }),
  );
  const item = result.current.menuFor(card.id).find((entry) => entry.label === "Delete forever");
  return { item, onDeleteForever };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * "Delete forever" is the one row action with no undo. It used to fire on the
 * menu click itself, so a slipped pointer destroyed a card permanently.
 */
describe("deleting a trashed card forever", () => {
  it("asks first, and deletes nothing when the reader declines", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { item, onDeleteForever } = rowActions();

    item?.onSelect?.();

    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0]?.[0]).toContain("Receipt");
    expect(onDeleteForever).not.toHaveBeenCalled();
  });

  it("deletes the card once the reader confirms", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { item, onDeleteForever } = rowActions();

    item?.onSelect?.();

    expect(onDeleteForever).toHaveBeenCalledWith(card.id);
  });
});
