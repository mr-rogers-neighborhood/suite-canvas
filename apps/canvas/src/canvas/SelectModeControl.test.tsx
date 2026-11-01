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

  it("should let a reader ask for sections and nothing else", () => {
    render(<SelectModeControl />);
    fireEvent.click(screen.getByTestId("select-mode-toggle"));
    fireEvent.click(screen.getByTestId("select-mode-cards"));
    fireEvent.click(screen.getByTestId("select-mode-links"));
    fireEvent.click(screen.getByTestId("select-mode-sections"));

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

  it("should draw nothing for a viewer, who boxes nothing", () => {
    useUiStore.setState({ canEditLayout: false });
    const { container } = render(<SelectModeControl />);
    expect(container).toBeEmptyDOMElement();
  });
});
