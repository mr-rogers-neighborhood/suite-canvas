import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { announce, resetAnnouncerForTests, useAnnouncerStore } from "./announcer";
import { LiveRegion } from "./LiveRegion";

beforeEach(() => {
  resetAnnouncerForTests();
});

describe("LiveRegion", () => {
  it("should keep both regions mounted and empty before anything is said", () => {
    render(<LiveRegion />);

    expect(screen.getByTestId("live-region-polite")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByTestId("live-region-assertive")).toHaveAttribute("aria-live", "assertive");
    expect(screen.getByTestId("live-region-polite")).toHaveTextContent("");
  });

  it("should put a polite sentence in the polite region only", () => {
    render(<LiveRegion />);
    act(() => {
      announce("Card created");
    });

    expect(screen.getByTestId("live-region-polite")).toHaveTextContent("Card created");
    expect(screen.getByTestId("live-region-assertive")).toHaveTextContent("");
  });

  it("should put an urgent sentence in the assertive region", () => {
    render(<LiveRegion />);
    act(() => {
      announce("This device is out of storage", { urgent: true });
    });

    expect(screen.getByTestId("live-region-assertive")).toHaveTextContent(
      "This device is out of storage",
    );
  });

  /**
   * A live region only speaks when its text changes. The identical sentence
   * twice is a real case (two peers leave, undo twice), so each announcement
   * carries a nonce that alternates an invisible character.
   */
  it("should give a repeated sentence different text so a reader speaks it again", () => {
    render(<LiveRegion />);

    act(() => {
      useAnnouncerStore.setState({ polite: { id: 1, message: "Ada left", urgent: false } });
    });
    const first = screen.getByTestId("live-region-polite").textContent ?? "";

    act(() => {
      useAnnouncerStore.setState({ polite: { id: 2, message: "Ada left", urgent: false } });
    });
    const second = screen.getByTestId("live-region-polite").textContent ?? "";

    expect(first).toContain("Ada left");
    expect(second).toContain("Ada left");
    expect(second).not.toBe(first);
  });
});
