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

function rowActions() {
  const setPendingPurge = vi.fn();
  const { result } = renderHook(() =>
    useLibraryRowActions({
      tab: "trash",
      ordered: [card],
      visibleBoards: [],
      activeBoardId: null,
      canManageTrash: true,
      onLocateCard: () => false,
      onLocateBoard: () => false,
      onOpenBoard: () => {},
      onPlaceBoard: () => {},
      onSetBoardTemplate: undefined,
      onUnplaceBoardCards: () => {},
      onRestore: () => {},
      onOpenCard: () => {},
      onGoToBoard: () => {},
      onPlace: () => {},
      onTrash: () => {},
      setLocateMiss: () => {},
      setPendingDelete: () => {},
      setPendingPurge,
    }),
  );
  const item = result.current.menuFor(card.id).find((entry) => entry.label === "Delete forever");
  return { item, setPendingPurge };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * "Delete forever" is the one row action with no undo. It used to fire on the
 * menu click itself, so a slipped pointer destroyed a card permanently; the
 * question it asks is the drawer's own `Dialog`, not `window.confirm`.
 */
describe("deleting a trashed card forever", () => {
  it("asks the drawer for its dialog instead of deleting on the click", () => {
    const { item, setPendingPurge } = rowActions();

    item?.onSelect?.();

    expect(setPendingPurge).toHaveBeenCalledWith({ id: card.id, title: card.title });
  });

  it("never falls back to the platform confirm", () => {
    const confirm = vi.spyOn(window, "confirm");
    const { item } = rowActions();

    item?.onSelect?.();

    expect(confirm).not.toHaveBeenCalled();
  });
});
