import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useDurabilityStore } from "../storage/durability";
import { useCanvasStore } from "../store/useCanvasStore";
import { resetAnnouncerForTests, useAnnouncerStore } from "./announcer";
import { SaveIndicator } from "./SaveIndicator";

beforeEach(() => {
  resetAnnouncerForTests();
  useCanvasStore.setState({ ready: true });
  useDurabilityStore.setState({ quota: null });
});

describe("SaveIndicator", () => {
  /**
   * jsdom has neither IndexedDB nor a `?workspace=` room, so this is exactly the
   * case the indicator exists for: a tab that cannot keep its own copy.
   */
  it("should say the copy is not kept here when the browser cannot store it", () => {
    render(<SaveIndicator />);

    const indicator = screen.getByTestId("save-indicator");
    expect(indicator).toHaveAttribute("data-state", "not-durable");
    expect(indicator).toHaveTextContent("Not saved to this device");
    expect(indicator).toHaveAttribute("title", expect.stringContaining("closing the tab"));
  });

  it("should say why, when a write was refused for space", () => {
    useDurabilityStore.setState({ quota: { message: "Storage is full.", at: 1 } });
    render(<SaveIndicator />);

    expect(screen.getByTestId("save-indicator")).toHaveAttribute(
      "title",
      expect.stringContaining("Storage is full."),
    );
  });

  it("should tell a screen reader the moment the copy stops being durable", () => {
    render(<SaveIndicator />);

    expect(useAnnouncerStore.getState().polite?.message).toBe("Not saved to this device");
  });
});
