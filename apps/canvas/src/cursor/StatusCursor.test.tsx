import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusCursor } from "./StatusCursor";

const ana = { name: "Ana", color: "#2563eb" };
const bo = { name: "Bo", color: "#e11d48" };

/** Slot names in document order: the cursor's fixed reading order (ADR-0064 §4). */
function slots(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll("[data-slot]")].map((node) =>
    node.getAttribute("data-slot"),
  );
}

describe("StatusCursor", () => {
  it("carries the owner's initial in their presence colour", () => {
    render(<StatusCursor user={ana} purpose="explore" gesture="place" isSelf={false} />);

    const bubble = screen.getByTestId("status-cursor-bubble");
    expect(bubble).toHaveTextContent("A");
    expect(bubble).toHaveStyle({ backgroundColor: "#2563eb" });
    // The corner pointer inherits this, so pointer and bubble cannot drift apart.
    expect(screen.getByTestId("status-cursor")).toHaveStyle({ color: "#2563eb" });
  });

  it("marks the ring with the purpose and gives every purpose its own shape", () => {
    const { rerender } = render(
      <StatusCursor user={ana} purpose="explore" gesture="place" isSelf />,
    );

    const resting = screen.getByTestId("status-cursor-ring");
    expect(resting).toHaveAttribute("data-purpose", "explore");
    expect(resting).toHaveClass("status-cursor__ring--explore");
    // At rest the ring is a plain outline.
    expect(resting).toHaveAttribute("data-shape", "solid");
    const restingShape = resting.getAttribute("data-shape");
    const restingClass = resting.className;

    rerender(<StatusCursor user={ana} purpose="present" gesture="place" isSelf />);

    const presenting = screen.getByTestId("status-cursor-ring");
    expect(presenting).toHaveAttribute("data-purpose", "present");
    expect(presenting).toHaveClass("status-cursor__ring--present");
    // Hue alone is not a signal (§5): the shape changes too, which is what makes
    // the state readable in a monochrome screenshot or to a colour-blind reader.
    expect(presenting).toHaveAttribute("data-shape", "halo");
    expect(presenting.getAttribute("data-shape")).not.toBe(restingShape);
    expect(presenting.className).not.toBe(restingClass);
  });

  it("carries the gesture slot only when the next click is not a plain placement", () => {
    const { container, rerender } = render(
      <StatusCursor user={ana} purpose="record" gesture="thread" isSelf={false} />,
    );

    // One slot is the whole vocabulary of a peer's cursor now: the run count, the unread
    // count and the stack of off-screen people went with the local bubble.
    expect(slots(container)).toEqual(["gesture"]);

    rerender(<StatusCursor user={ana} purpose="record" gesture="place" isSelf={false} />);

    expect(slots(container)).toEqual([]);
  });

  it("stays quiet about the gesture while the next click is a plain placement", () => {
    render(<StatusCursor user={ana} purpose="explore" gesture="place" isSelf={false} />);

    expect(screen.queryByTestId("status-cursor-gesture")).toBeNull();
    // ...and the label does not name a gesture it is not making.
    expect(screen.getByTestId("status-cursor-bubble")).toHaveAttribute(
      "title",
      "Ana \u2014 exploring",
    );
  });

  it("names the state it is in, so the ring is never the only signal", () => {
    const { rerender } = render(
      <StatusCursor user={ana} purpose="record" gesture="place" isSelf />,
    );

    expect(screen.getByTestId("status-cursor-bubble")).toHaveAttribute(
      "title",
      "Ana \u2014 recording a tour",
    );
    expect(screen.getByTestId("status-cursor-bubble")).toHaveAccessibleName(
      "Ana \u2014 recording a tour",
    );

    rerender(<StatusCursor user={ana} purpose="record" gesture="thread" isSelf={false} />);

    // Purpose and gesture, in one sentence: a screenshot of the bubble is legible
    // without the widget the other reader is looking at.
    expect(screen.getByTestId("status-cursor-bubble")).toHaveAttribute(
      "title",
      "Ana \u2014 recording a tour \u00b7 thread",
    );
  });

  it("keeps everything but the bubble transparent to the pointer", () => {
    const { container } = render(
      <StatusCursor user={ana} purpose="record" gesture="fan" isSelf={false} />,
    );

    // Expressed as classes because the discipline is the stylesheet's: the layer wraps a
    // pointer-events-none root and opts the one button back in.
    expect(container.firstElementChild).toHaveClass("status-cursor");
    expect(screen.getByTestId("status-cursor-bubble")).toHaveClass("status-cursor__bubble");
    expect(screen.getByTestId("status-cursor-ring")).toHaveClass("status-cursor__ring");
  });

  it("keeps a peer's cursor out of the reader's tab order", () => {
    render(<StatusCursor user={bo} purpose="record" gesture="place" isSelf={false} />);

    expect(screen.getByTestId("status-cursor-bubble")).toHaveAttribute("tabindex", "-1");
  });
});
