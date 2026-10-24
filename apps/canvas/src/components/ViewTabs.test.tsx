import type { View } from "@suite/graph";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ViewTabs } from "./ViewTabs";

const views: View[] = [
  {
    id: "v1",
    name: "Research",
    camera: { x: 0, y: 0, zoom: 1 },
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "v2",
    name: "Drafts",
    camera: { x: 120, y: 40, zoom: 0.5 },
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "v3",
    name: "Archive",
    camera: { x: 0, y: 0, zoom: 1 },
    createdAt: 2,
    updatedAt: 2,
  },
];

const baseProps = {
  views,
  activeViewId: "v1",
  onSelect: vi.fn(),
  onCreate: vi.fn(),
  onRename: vi.fn(),
  onDeleteRequest: vi.fn(),
};

describe("ViewTabs presence", () => {
  it("should mark each view a peer is reading and name them", () => {
    render(
      <ViewTabs
        {...baseProps}
        peersByView={{
          v2: { label: "Ada, Bob", color: "#ff0000" },
          v3: { label: "Cy", color: "#0000ff" },
        }}
      />,
    );

    const dots = screen.getAllByTestId("view-tab-peer-dot");
    expect(dots).toHaveLength(2);
    expect(dots[0]).toHaveAttribute("aria-label", "Ada, Bob here now");
    expect(dots[0]).toHaveAttribute("title", "Ada, Bob here now");
    expect(dots[1]).toHaveAttribute("aria-label", "Cy here now");

    // The view without company carries no dot.
    expect(
      screen.getByTestId("board-tab-v1").querySelector('[data-testid="view-tab-peer-dot"]'),
    ).toBeNull();
  });

  it("should render no presence dots without peers", () => {
    render(<ViewTabs {...baseProps} />);
    expect(screen.queryAllByTestId("view-tab-peer-dot")).toHaveLength(0);
  });

  it("should select the view a tab names", () => {
    const onSelect = vi.fn();
    render(<ViewTabs {...baseProps} onSelect={onSelect} />);

    screen.getByTestId("board-tab-v2").click();

    expect(onSelect).toHaveBeenCalledWith("v2");
  });
});
