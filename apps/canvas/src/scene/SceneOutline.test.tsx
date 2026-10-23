import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { SceneOutline, type SceneOutlineItem } from "./SceneOutline";

const items: SceneOutlineItem[] = [
  {
    id: "board:a",
    label: "Board A",
    kind: "board",
    depth: 0,
    lod: "full",
    expanded: true,
    hasChildren: true,
    cardCount: 3,
  },
  {
    id: "portal:b",
    label: "Portal to Board B",
    kind: "portal",
    depth: 1,
    lod: "compact",
    expanded: true,
    hasChildren: true,
    portalCardId: "portal-1",
    cardCount: 2,
    peers: [{ name: "Ada", color: "#3b82f6" }],
  },
  {
    id: "board:b",
    label: "Board B",
    kind: "board",
    depth: 2,
    lod: "icon",
    expanded: false,
    hasChildren: false,
    boardId: "board-b",
  },
  {
    id: "portal:a",
    label: "Back to Board A",
    kind: "cycle",
    depth: 3,
    lod: "hidden",
    expanded: false,
    hasChildren: false,
    cycle: true,
  },
];

function mount(overrides: Partial<ComponentProps<typeof SceneOutline>> = {}) {
  const handlers = {
    onToggleOpen: vi.fn(),
    onSelect: vi.fn(),
    onToggleExpand: vi.fn(),
    onBack: vi.fn(),
  };
  render(<SceneOutline items={items} activeId="portal:b" open {...handlers} {...overrides} />);
  return handlers;
}

describe("SceneOutline", () => {
  it("should render the scene tree with depth, LOD and cycle markers", () => {
    mount();

    const rows = screen.getAllByTestId("scene-outline-row");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveAttribute("aria-level", "1");
    expect(rows[2]).toHaveAttribute("aria-level", "3");
    expect(rows[0]).toHaveAttribute("aria-expanded", "true");
    expect(rows[2]).not.toHaveAttribute("aria-expanded");
    expect(rows[3]).toHaveAttribute("data-kind", "cycle");
    expect(rows[2]).toHaveAttribute("data-lod", "icon");
    expect(screen.getByTestId("scene-outline-count")).toHaveTextContent("2");
    expect(screen.getAllByTestId("scene-outline-peer")).toHaveLength(1);
    expect(screen.getAllByTestId("scene-outline-card-count")[0]).toHaveTextContent("3");
  });

  it("should select a row and toggle its disclosure", () => {
    const handlers = mount();

    fireEvent.click(screen.getAllByTestId("scene-outline-label")[1] as HTMLElement);
    expect(handlers.onSelect).toHaveBeenCalledWith(items[1]);

    fireEvent.click(screen.getAllByTestId("scene-outline-expand")[0] as HTMLElement);
    expect(handlers.onToggleExpand).toHaveBeenCalledWith(items[0]);
  });

  it("should move focus with the arrow keys and collapse with ArrowLeft", () => {
    const handlers = mount();
    const labels = screen.getAllByTestId("scene-outline-label");

    (labels[0] as HTMLElement).focus();
    fireEvent.keyDown(labels[0] as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(labels[1]);

    fireEvent.keyDown(labels[1] as HTMLElement, { key: "ArrowLeft" });
    expect(handlers.onToggleExpand).toHaveBeenCalledWith(items[1]);

    fireEvent.keyDown(labels[0] as HTMLElement, { key: "End" });
    expect(document.activeElement).toBe(labels[3]);
  });

  it("should enter the selected row with Enter and use Escape for back", () => {
    const handlers = mount();
    const labels = screen.getAllByTestId("scene-outline-label");

    fireEvent.keyDown(labels[2] as HTMLElement, { key: "Enter" });
    expect(handlers.onSelect).toHaveBeenCalledWith(items[2]);

    fireEvent.keyDown(labels[2] as HTMLElement, { key: "Escape" });
    expect(handlers.onBack).toHaveBeenCalled();
  });

  it("should render a collapsed tab and reopen from it", () => {
    const handlers = mount({ open: false });

    expect(screen.queryByTestId("scene-outline")).toBeNull();
    const tab = screen.getByTestId("scene-outline-tab");
    expect(tab).toHaveAccessibleName("Scene 2");
    expect(tab).toHaveAttribute("title", "Scene outline, 2 boards");
    fireEvent.click(tab);
    expect(handlers.onToggleOpen).toHaveBeenCalled();
  });

  it("should name an unavailable target without hiding the row", () => {
    mount({
      items: [{ ...items[2], unavailable: true }],
    });
    const label = screen.getByTestId("scene-outline-label");
    expect(label).toHaveAccessibleName(/Board B.*unavailable/);
    expect(screen.getByTestId("scene-outline-row")).toHaveAttribute("data-kind", "board");
  });
});
