import type { Placement, Section } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PortalCard } from "./PortalCard";
import { boardMiniature } from "./portalMiniature";

const placement = (cardId: string, x: number): Placement => ({
  boardId: "b1",
  cardId,
  x,
  y: 0,
  z: 0,
  createdAt: 0,
});

const section = (id: string, x: number): Section => ({
  id,
  boardId: "b1",
  title: "Notes",
  x,
  y: 0,
  width: 400,
  height: 300,
  z: 0,
  color: "blue",
  tags: [],
  createdAt: 0,
  updatedAt: 0,
});

const model = boardMiniature(
  [section("s1", 0)],
  [placement("c1", 0), placement("c2", 300), placement("c3", 600)],
);

describe("PortalCard", () => {
  it("should render the target board's name, miniature and card count", () => {
    render(<PortalCard boardName="Research" glyph={"\u25c9"} model={model} />);

    const card = screen.getByTestId("portal-node");
    expect(card).toHaveAccessibleName(/Portal to Research/);
    expect(screen.getByTestId("portal-miniature")).toBeInTheDocument();
    expect(screen.getByTestId("portal-card-count")).toHaveTextContent("3 cards");
    expect(screen.getByText("Research")).toBeInTheDocument();
  });

  it("should open on double-click and on Enter/Space", () => {
    const onOpen = vi.fn();
    render(<PortalCard boardName="Research" glyph={"\u25c9"} model={model} onOpen={onOpen} />);

    const card = screen.getByTestId("portal-node");
    fireEvent.doubleClick(card);
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it("should never open an unavailable target", () => {
    const onOpen = vi.fn();
    render(
      <PortalCard
        boardName={null}
        glyph={"\u25c9"}
        model={boardMiniature([], [])}
        onOpen={onOpen}
      />,
    );

    const card = screen.getByTestId("portal-node");
    expect(card).toHaveAttribute("aria-disabled", "true");
    expect(card).toHaveAccessibleName(/Portal to Unavailable board/);
    expect(card).toHaveAttribute("data-unavailable", "true");
    expect(screen.getByTestId("portal-unavailable")).toHaveTextContent("Unavailable board");
    expect(screen.queryByTestId("portal-miniature")).not.toBeInTheDocument();

    fireEvent.doubleClick(card);
    fireEvent.keyDown(card, { key: "Enter" });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("should name the peers reading the target board", () => {
    render(
      <PortalCard
        boardName="Research"
        glyph={"\u25c9"}
        model={model}
        peers={[
          { name: "Ada", color: "#ff0000" },
          { name: "Bob", color: "#00ff00" },
        ]}
      />,
    );

    const presence = screen.getByTestId("portal-presence");
    expect(presence).toHaveAttribute("aria-label", "Here now: Ada, Bob");
    expect(presence).toHaveAttribute("title", "Ada, Bob");
    expect(screen.getAllByTestId("presence-avatar")).toHaveLength(2);
  });

  it("should show an empty board without pretending it has cards", () => {
    render(<PortalCard boardName="Drafts" glyph={"\u25c9"} model={boardMiniature([], [])} />);
    expect(screen.getByTestId("portal-card-count")).toHaveTextContent("0 cards");
    expect(screen.getByText("Empty board")).toBeInTheDocument();
  });
});
