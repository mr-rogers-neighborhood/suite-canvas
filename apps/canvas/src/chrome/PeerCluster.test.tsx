import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePresenceStore } from "../collab/usePresenceStore";
import { PeerCluster } from "./PeerCluster";

const board = "board-1";

function peer(clientId: string, name: string, on: string | null) {
  return {
    clientId,
    board: on,
    user: { name, color: "#ff0000" },
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
  };
}

beforeEach(() => {
  usePresenceStore.setState({ peers: {} });
});

afterEach(cleanup);

describe("who else is here", () => {
  it("says nothing when nobody is", () => {
    render(<PeerCluster boardId={board} />);
    expect(screen.queryByTestId("peer-cluster")).toBeNull();
  });

  it("names people on this board as here", () => {
    usePresenceStore.setState({ peers: { a: peer("a", "Ada", board) } as never });
    render(<PeerCluster boardId={board} />);
    expect(screen.getByTestId("peer-cluster")).toHaveTextContent("1 other person here");
  });

  it("says somebody on another board is elsewhere, rather than hiding them", () => {
    // A workspace where another person is in the room without you knowing is worse than one
    // that says so: presence is scoped to the workspace, not to the board.
    usePresenceStore.setState({
      peers: { a: peer("a", "Ada", "board-2"), b: peer("b", "Bo", board) } as never,
    });
    render(<PeerCluster boardId={board} />);
    expect(screen.getByTestId("peer-cluster")).toHaveTextContent(
      "1 person elsewhere in this workspace",
    );
    expect(screen.getAllByTestId("peer-dot")).toHaveLength(2);
  });
});
