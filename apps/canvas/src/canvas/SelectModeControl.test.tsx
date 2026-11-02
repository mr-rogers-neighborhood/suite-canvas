import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "../store/useUiStore";
import { SelectModeControl } from "./SelectModeControl";

/**
 * What a selection box picks up.
 *
 * A marquee used to box every card it touched and sweep up any section link it crossed. A box over a busy board usually
 * wants one of those, so this is three toggles rather than a mode to cycle: they combine, and a cycle cannot show two at
 * once.
 */
beforeEach(() => {
  useUiStore.setState({
    canEditLayout: true,
    marqueeSelects: { cards: true, links: true, sections: false },
  });
});

describe("the select-mode control", () => {
  it("should say what a box picks up while it is closed", () => {
    render(<SelectModeControl />);
    expect(screen.getByTestId("select-mode-toggle")).toHaveAttribute(
      "title",
      "Boxing picks up cards and links",
    );
  });

  it("should open to one toggle per thing, showing what is in force", () => {
    render(<SelectModeControl />);
    fireEvent.click(screen.getByTestId("select-mode-toggle"));

    expect(screen.getByTestId("select-mode-cards")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("select-mode-links")).toHaveAttribute("aria-pressed", "true");
    // A section is not a card, so it starts off.
    expect(screen.getByTestId("select-mode-sections")).toHaveAttribute("aria-pressed", "false");
  });

  it("should toggle one thing without touching the others", () => {
    render(<SelectModeControl />);
    fireEvent.click(screen.getByTestId("select-mode-toggle"));
    fireEvent.click(screen.getByTestId("select-mode-cards"));

    expect(useUiStore.getState().marqueeSelects).toEqual({
      cards: false,
      links: true,
      sections: false,
    });
  });

  /**
   * Sections and nothing else, which is the case the toggles exist for.
   *
   * The order matters and is the reader's: turn the new subject on, then the old ones off. Turning the last one off first
   * would leave a box that picks up nothing, which is refused — so "everything off, then the one you want on" is the
   * gesture this rule deliberately does not support.
   */
  it("should let a reader ask for sections and nothing else", () => {
    render(<SelectModeControl />);
    fireEvent.click(screen.getByTestId("select-mode-toggle"));
    fireEvent.click(screen.getByTestId("select-mode-sections"));
    fireEvent.click(screen.getByTestId("select-mode-cards"));
    fireEvent.click(screen.getByTestId("select-mode-links"));

    expect(useUiStore.getState().marqueeSelects).toEqual({
      cards: false,
      links: false,
      sections: true,
    });
    expect(screen.getByTestId("select-mode-toggle")).toHaveAttribute(
      "title",
      "Boxing picks up sections",
    );
  });

  it("should refuse to leave a box that picks up nothing", () => {
    render(<SelectModeControl />);
    fireEvent.click(screen.getByTestId("select-mode-toggle"));
    // Cards and links are on and sections is off, so links is the last one standing once cards goes.
    fireEvent.click(screen.getByTestId("select-mode-cards"));

    const links = screen.getByTestId("select-mode-links");
    expect(links).toBeDisabled();
    expect(links).toHaveAttribute("title", "A selection box has to pick something up");

    fireEvent.click(links);
    expect(useUiStore.getState().marqueeSelects.links).toBe(true);
  });

  it("should draw nothing for a viewer, who boxes nothing", () => {
    useUiStore.setState({ canEditLayout: false });
    const { container } = render(<SelectModeControl />);
    expect(container).toBeEmptyDOMElement();
  });
});
