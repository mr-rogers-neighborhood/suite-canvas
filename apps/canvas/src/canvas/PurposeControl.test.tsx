import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "../store/useUiStore";
import { PurposeControl } from "./PurposeControl";

const toggle = () => screen.getByTestId("purpose-toggle");

beforeEach(() => {
  useUiStore.setState({ purpose: "explore", tour: null });
});

/**
 * The purpose control (ADR-0064 amendment).
 *
 * It is a toggle now, not a cycle. `run` left the axis because a queue can only come from
 * the library, and so did the modifier preview — holding Shift to thread was being read
 * as "run", which is the collision that made the second menu cost more than it explained.
 */
describe("the purpose control", () => {
  it("turns explain on and off, and nothing else", () => {
    render(<PurposeControl />);

    expect(toggle()).toHaveAttribute("data-purpose", "explore");
    expect(toggle()).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("data-purpose", "explain");
    expect(toggle()).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("data-purpose", "explore");
    expect(useUiStore.getState().purpose).toBe("explore");
  });

  it("never offers run, record or present, however available they look", () => {
    useUiStore.setState({
      tour: { tutorialId: "t", stepIndex: 0, presenting: false, panelOpen: true },
    });
    render(<PurposeControl />);

    // Four clicks is more than a lap of the old cycle; none of them may land on a state
    // only the library or a tour can enter.
    for (let click = 0; click < 4; click += 1) {
      expect(["explore", "explain"]).toContain(toggle().getAttribute("data-purpose"));
      fireEvent.click(toggle());
    }
  });

  it("stands down while a run is in hand, because the run bar is its control", () => {
    useUiStore.setState({ purpose: "run" });
    render(<PurposeControl />);
    expect(screen.queryByTestId("purpose-toggle")).toBeNull();
  });

  it("stays as the exit from a state only a tour can enter", () => {
    // The takeover has no other control on screen, so the widget is the way out — and a
    // click there leaves the state rather than choosing another one (ADR-0064 §11).
    for (const purpose of ["present", "record"] as const) {
      useUiStore.setState({ purpose });
      const { unmount } = render(<PurposeControl />);
      expect(toggle()).toHaveAttribute("data-purpose", purpose);
      fireEvent.click(toggle());
      expect(useUiStore.getState().purpose).toBe("explore");
      unmount();
    }
  });

  it("names the way it will go, so a click is never a surprise", () => {
    render(<PurposeControl />);
    expect(toggle()).toHaveAttribute("title", expect.stringContaining("Explain mode"));

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("title", expect.stringContaining("Stop explaining"));
  });
});
