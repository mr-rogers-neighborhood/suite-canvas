import type { Placement, Section } from "@suite/graph";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { preloadIconSet } from "../icons/iconSets";
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

  it("draws the icon it was given where the type glyph was", async () => {
    await preloadIconSet("lucide");
    const { unmount } = render(<PortalCard boardName="Research" glyph={"\u25c9"} model={model} />);
    expect(screen.getByTestId("portal-glyph")).toHaveTextContent("\u25c9");
    unmount();

    // The chosen icon replaces the circled dot rather than sitting beside it.
    render(
      <PortalCard boardName="Research" glyph={"\u25c9"} model={model} icon="lucide:compass" />,
    );
    const glyph = screen.getByTestId("portal-glyph");
    await waitFor(() =>
      expect(glyph.querySelector("svg")).toHaveAttribute("data-icon", "lucide:compass"),
    );
    expect(glyph).not.toHaveTextContent("\u25c9");
  });

  it("folds to its header, keeping the count", () => {
    const onToggleCollapsed = vi.fn();
    render(
      <PortalCard
        boardName="Research"
        glyph={"\u25c9"}
        model={model}
        collapsed
        onToggleCollapsed={onToggleCollapsed}
      />,
    );

    // The frame and the footer step out of the way; the header keeps the name and the count.
    expect(screen.getByTestId("portal-node")).toHaveAttribute("data-collapsed", "true");
    expect(screen.queryByTestId("portal-miniature")).toBeNull();
    expect(screen.queryByTestId("portal-card-count")).toBeNull();
    expect(screen.getByTestId("portal-folded-count")).toHaveTextContent("3 cards");
    expect(screen.getByTestId("portal-glyph")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("portal-fold"));
    expect(onToggleCollapsed).toHaveBeenCalledOnce();
  });

  it("offers no fold when the surface owns none", () => {
    render(<PortalCard boardName="Research" glyph={"\u25c9"} model={model} />);
    expect(screen.queryByTestId("portal-fold")).toBeNull();
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
