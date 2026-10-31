import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { usePinStore } from "../store/pinStore";
import { PinnedCards } from "./PinnedCards";

beforeEach(() => {
  usePinStore.getState().clear();
});

describe("the pinned layer", () => {
  it("should draw nothing until a card is pinned", () => {
    render(<PinnedCards />);
    expect(screen.queryByTestId("pinned-cards")).toBeNull();
  });

  it("should keep pins out of the document", () => {
    // The store is the whole story: pinning must not touch a workspace, which is why
    // this layer can render with no canvas at all.
    usePinStore.getState().pin("card-1", { x: 40, y: 40, width: 320, height: 240 });
    expect(usePinStore.getState().pinned).toEqual(["card-1"]);
    render(<PinnedCards />);
    // No workspace in this test, so no card is drawn: the layer still refuses to render
    // a pin it cannot resolve rather than drawing an empty frame.
    expect(screen.queryByTestId("pinned-card-card-1")).toBeNull();
  });

  it("should forget a pin when it is unpinned", () => {
    usePinStore.getState().pin("card-1", { x: 40, y: 40, width: 320, height: 240 });
    usePinStore.getState().unpin("card-1");
    expect(usePinStore.getState().pinned).toEqual([]);
    expect(usePinStore.getState().rects["card-1"]).toBeUndefined();
  });
});
