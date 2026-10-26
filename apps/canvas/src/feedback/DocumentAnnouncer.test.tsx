import { WorkspaceDocument } from "@suite/graph";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { PeerPresence } from "../collab/presence";
import { usePresenceStore } from "../collab/usePresenceStore";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { resetAnnouncerForTests } from "./announcer";
import { DocumentAnnouncer, SELECTION_SETTLE_MS } from "./DocumentAnnouncer";
import { LiveRegion } from "./LiveRegion";

// `useCanvasStore` owns one document for the whole module graph, so ids are
// unique per test rather than assumed to start from an empty workspace.
let cardSequence = 0;
function nextCardId(prefix: string): string {
  cardSequence += 1;
  return `${prefix}-${cardSequence}`;
}

function peer(clientId: string, name: string): PeerPresence {
  return {
    clientId,
    board: null,
    user: { name, color: "#3b82f6" },
    pointer: null,
    focus: null,
    dragging: null,
    selection: null,
    selectionBox: null,
    connector: null,
    resizing: null,
    sectionDrag: null,
    sectionResize: null,
    reconnect: null,
    connect: null,
    labelDrag: null,
  } as PeerPresence;
}

function setup() {
  render(
    <>
      <LiveRegion />
      <DocumentAnnouncer />
    </>,
  );
  return screen.getByTestId("live-region-polite");
}

beforeEach(() => {
  resetAnnouncerForTests();
  usePresenceStore.setState({ peers: {} });
  useUiStore.setState({ activeBoardId: null, selectedNodeIds: [], selectedEdgeIds: [] });
});

describe("DocumentAnnouncer", () => {
  it("should announce a card this tab creates", () => {
    const region = setup();

    act(() => {
      useCanvasStore.getState().workspace.createCard({ id: nextCardId("created") });
    });

    expect(region).toHaveTextContent("Card created");
  });

  it("should announce a card this tab trashes", () => {
    const cardId = nextCardId("trashed");
    const workspace = useCanvasStore.getState().workspace;
    act(() => {
      workspace.createCard({ id: cardId });
    });
    const region = setup();

    act(() => {
      workspace.trashCard(cardId);
    });

    expect(region).toHaveTextContent("Card moved to Trash");
  });

  /**
   * Typing is a local commit that changes no card record. If the gate only
   * counted commits, the count would sit ahead of the snapshot and the next
   * peer's card would be reported as this tab's own work.
   */
  it("should not report a peer's card as local after a local edit that changed no card", () => {
    const workspace = useCanvasStore.getState().workspace;
    const region = setup();

    act(() => {
      workspace.renameWorkspace("Renamed here");
    });
    expect(region.textContent).not.toContain("Card created");

    const other = new WorkspaceDocument();
    other.createCard({ id: nextCardId("remote") });
    act(() => {
      workspace.importUpdate(other.exportUpdate());
    });

    expect(region.textContent).not.toContain("Card created");
  });

  it("should say nothing about a card another peer's update brought in", () => {
    const region = setup();
    const other = new WorkspaceDocument();
    other.createCard({ id: nextCardId("remote") });

    act(() => {
      // An import is how a peer's work and hydration arrive; neither is this
      // tab's own edit, so it is not reported as one.
      useCanvasStore.getState().workspace.importUpdate(other.exportUpdate());
    });

    expect(region.textContent).not.toContain("Card created");
  });

  it("should name the board a switch lands on", () => {
    const workspace = useCanvasStore.getState().workspace;
    const board = workspace.ensureBoard();
    workspace.renameBoard(board.id, "Research");
    const region = setup();

    act(() => {
      useUiStore.getState().setActiveBoardId(board.id);
    });

    expect(region).toHaveTextContent("Board: Research");
  });

  it("should announce how many items a selection holds, once it settles", async () => {
    const region = setup();

    act(() => {
      useUiStore.getState().setSelectedNodeIds([nextCardId("sel")]);
    });
    act(() => {
      useUiStore
        .getState()
        .setSelectedNodeIds([nextCardId("sel"), nextCardId("sel"), nextCardId("sel")]);
    });
    expect(region).toHaveTextContent("");

    await act(async () => {
      // The settle window, so a pointer sweeping a marquee reads as one event.
      await new Promise((resolve) => setTimeout(resolve, SELECTION_SETTLE_MS + 20));
    });

    expect(region).toHaveTextContent("3 items selected");
  });

  it("should say nothing selected when a selection is cleared", async () => {
    const region = setup();

    act(() => {
      useUiStore.getState().setSelectedNodeIds([nextCardId("sel")]);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SELECTION_SETTLE_MS + 20));
    });
    expect(region).toHaveTextContent("1 item selected");

    act(() => {
      useUiStore.getState().setSelectedNodeIds([]);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SELECTION_SETTLE_MS + 20));
    });
    expect(region).toHaveTextContent("Nothing selected");
  });

  it("should name a peer who joined and a peer who left", () => {
    const region = setup();

    act(() => {
      usePresenceStore.setState({ peers: { "peer-a": peer("peer-a", "Ada") } });
    });
    expect(region).toHaveTextContent("Ada joined");

    act(() => {
      usePresenceStore.setState({ peers: {} });
    });
    expect(region).toHaveTextContent("Ada left");
  });
});
