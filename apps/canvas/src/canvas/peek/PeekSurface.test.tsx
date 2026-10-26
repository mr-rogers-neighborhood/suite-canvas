import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PeekSurface } from "./PeekSurface";
import type { PeekState } from "./usePeek";

const cardPeek: PeekState = {
  entity: {
    target: { kind: "card", id: "alpha" },
    label: "Retrieval beats re-reading",
    kindLabel: "claim",
    detail: "On Research",
  },
  anchor: { x: 40, y: 80 },
};

describe("PeekSurface", () => {
  it("should render nothing when there is no peek", () => {
    const { container } = render(<PeekSurface peek={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("should name the thing, its kind and one line of context", () => {
    render(<PeekSurface peek={cardPeek} />);
    expect(screen.getByTestId("peek-label")).toHaveTextContent("Retrieval beats re-reading");
    expect(screen.getByTestId("peek-kind")).toHaveTextContent("claim");
    expect(screen.getByTestId("peek-detail")).toHaveTextContent("On Research");
  });

  it("should be a named dialog rather than a tooltip, because it holds a button", () => {
    render(<PeekSurface peek={cardPeek} onOpen={() => {}} />);
    const surface = screen.getByRole("dialog", { name: "Retrieval beats re-reading, claim" });
    expect(surface).toHaveAttribute("data-target-id", "alpha");
  });

  it("should offer exactly one route to open what it names", () => {
    const onOpen = vi.fn();
    render(<PeekSurface peek={cardPeek} onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId("peek-open"));
    expect(onOpen).toHaveBeenCalledWith({ kind: "card", id: "alpha" });
  });

  it("should render no button at all when the surface has nowhere to go", () => {
    render(<PeekSurface peek={cardPeek} />);
    expect(screen.queryByTestId("peek-open")).toBeNull();
  });

  it("should report a pointer entering and leaving, so the grace period can restart", () => {
    const onEnter = vi.fn();
    const onLeave = vi.fn();
    render(<PeekSurface peek={cardPeek} onEnter={onEnter} onLeave={onLeave} />);
    const surface = screen.getByTestId("peek-surface");
    fireEvent.pointerEnter(surface);
    fireEvent.pointerLeave(surface);
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("should place itself where the trigger was", () => {
    render(<PeekSurface peek={cardPeek} />);
    const surface = screen.getByTestId("peek-surface");
    expect(surface.style.left).toBe("40px");
    expect(surface.style.top).toBe("80px");
  });

  it("should render a peek with no context line rather than an empty one", () => {
    render(<PeekSurface peek={{ entity: { ...cardPeek.entity, detail: null }, anchor: null }} />);
    expect(screen.queryByTestId("peek-detail")).toBeNull();
  });
});
