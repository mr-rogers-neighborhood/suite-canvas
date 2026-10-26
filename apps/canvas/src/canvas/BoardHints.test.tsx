import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NudgeHint } from "./BoardHints";
import { NUDGE_LARGE_STEP, NUDGE_STEP } from "./nudge";

/**
 * The hint is the discoverability half of arrow-key movement: the keys already
 * worked, and nothing on screen said so.
 */

describe("the nudge hint", () => {
  it("says nothing without a selection", () => {
    render(<NudgeHint count={0} />);

    expect(screen.queryByTestId("nudge-hint")).toBeNull();
  });

  it("lifts out of the way of the bulk style bar for a multi-selection", () => {
    render(<NudgeHint count={3} lifted />);

    expect(screen.getByTestId("nudge-hint")).toHaveClass("board-hint--lifted");
  });

  it("names both steps, matching what the board applies", () => {
    render(<NudgeHint count={1} />);

    const hint = screen.getByTestId("nudge-hint");
    expect(hint).toHaveTextContent(`move ${NUDGE_STEP}`);
    expect(hint).toHaveTextContent(`Shift`);
    expect(hint).toHaveTextContent(`moves ${NUDGE_LARGE_STEP}`);
  });
});
