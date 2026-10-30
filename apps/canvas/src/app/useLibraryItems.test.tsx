import { WorkspaceDocument } from "@suite/graph";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readWorkspace } from "../store/workspaceSnapshotStore";
import { useLibraryItems } from "./useLibraryItems";

function createSeededWorkspace() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const card1 = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  const card2 = workspace.createCard(); // unplaced
  const card3 = workspace.createCard(); // unplaced, to trash
  workspace.trashCard(card3.id);
  workspace.setTitleText(card1.id, "Placed Card");
  workspace.setTitleText(card2.id, "Inbox Card");
  workspace.setTitleText(card3.id, "Trash Card");
  const snapshot = readWorkspace(workspace);
  return { workspace, snapshot, board, card1, card2, card3 };
}

describe("useLibraryItems", () => {
  it("defers computing items and returns empty lists when libraryOpen is false", () => {
    const { workspace, snapshot } = createSeededWorkspace();
    const sectionIdsFor = () => [];

    const { result } = renderHook(
      ({ libraryOpen }) =>
        useLibraryItems({
          snapshot,
          workspace,
          sectionIdsFor,
          libraryOpen,
        }),
      { initialProps: { libraryOpen: false } },
    );

    expect(result.current.inboxItems).toEqual([]);
    expect(result.current.cardItems).toEqual([]);
    expect(result.current.trashItems).toEqual([]);
    // Counts and unplaced / trashed IDs are still available
    expect(result.current.unplaced).toHaveLength(1);
    expect(result.current.trashed).toHaveLength(1);
  });

  it("evaluates items when libraryOpen is true", () => {
    const { workspace, snapshot } = createSeededWorkspace();
    const sectionIdsFor = () => [];

    const { result, rerender } = renderHook(
      ({ libraryOpen }) =>
        useLibraryItems({
          snapshot,
          workspace,
          sectionIdsFor,
          libraryOpen,
        }),
      { initialProps: { libraryOpen: false } },
    );

    expect(result.current.cardItems).toEqual([]);

    rerender({ libraryOpen: true });

    expect(result.current.inboxItems.length).toBeGreaterThan(0);
    expect(result.current.cardItems.length).toBeGreaterThan(0);
    expect(result.current.trashItems.length).toBeGreaterThan(0);

    const inboxTitles = result.current.inboxItems.map((item) => item.title);
    expect(inboxTitles).toContain("Inbox Card");
  });

  it("updates unplaced cards and inboxItems when placements change", () => {
    const { workspace, snapshot: initialSnapshot, board, card2 } = createSeededWorkspace();
    const sectionIdsFor = () => [];

    const { result, rerender } = renderHook(
      ({ snapshot }) =>
        useLibraryItems({
          snapshot,
          workspace,
          sectionIdsFor,
          libraryOpen: true,
        }),
      { initialProps: { snapshot: initialSnapshot } },
    );

    expect(result.current.unplaced).toEqual([card2.id]);
    expect(result.current.inboxItems).toHaveLength(1);

    // Place card2 onto board
    workspace.placeCard(board.id, card2.id, { x: 50, y: 50 });
    // Simulate what mergeSnapshots preserves: cards array is unchanged
    const nextSnapshot = {
      ...initialSnapshot,
      cards: initialSnapshot.cards,
      placements: workspace.listPlacements(),
    };

    rerender({ snapshot: nextSnapshot });

    expect(result.current.unplaced).toHaveLength(0);
    expect(result.current.inboxItems).toHaveLength(0);
  });

  it("updates inbox item titles when a card is renamed without changing card ID list", () => {
    const { workspace, snapshot: initialSnapshot, card2 } = createSeededWorkspace();
    const sectionIdsFor = () => [];

    const { result, rerender } = renderHook(
      ({ snapshot }) =>
        useLibraryItems({
          snapshot,
          workspace,
          sectionIdsFor,
          libraryOpen: true,
        }),
      { initialProps: { snapshot: initialSnapshot } },
    );

    expect(result.current.inboxItems.find((item) => item.id === card2.id)?.title).toBe(
      "Inbox Card",
    );

    workspace.setTitleText(card2.id, "Renamed Inbox Card");
    // Snapshot changes (e.g. from observe)
    const nextSnapshot = {
      ...initialSnapshot,
      cards: initialSnapshot.cards,
    };

    rerender({ snapshot: nextSnapshot });

    expect(result.current.inboxItems.find((item) => item.id === card2.id)?.title).toBe(
      "Renamed Inbox Card",
    );
  });

  it("updates cardItems board placements when a card is placed", () => {
    const { workspace, snapshot: initialSnapshot, board, card2 } = createSeededWorkspace();
    const sectionIdsFor = () => [];

    const { result, rerender } = renderHook(
      ({ snapshot }) =>
        useLibraryItems({
          snapshot,
          workspace,
          sectionIdsFor,
          libraryOpen: true,
        }),
      { initialProps: { snapshot: initialSnapshot } },
    );

    const initialCardItem = result.current.cardItems.find((item) => item.id === card2.id);
    expect(initialCardItem?.boards).toEqual([]);

    workspace.placeCard(board.id, card2.id, { x: 10, y: 10 });
    const nextSnapshot = {
      ...initialSnapshot,
      placements: workspace.listPlacements(),
    };

    rerender({ snapshot: nextSnapshot });

    const updatedCardItem = result.current.cardItems.find((item) => item.id === card2.id);
    expect(updatedCardItem?.boards).toEqual([{ id: board.id, name: board.name }]);
  });
});
