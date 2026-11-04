import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "../store/useUiStore";
import { SelectModeControl } from "./SelectModeControl";

/**
 * What a selection box picks up.
 *
 * A marquee used to box every card it touched and sweep up any section link it crossed. A box over a busy board usually
 * wants one of those, so this is three toggles rather than a mode to cycle: they combine, and a cycle cannot show two at
 * once. All three start on.
 */
const allOn = { cards: true, links: true, sections: true };

beforeEach(() => {
  useUiStore.setState({ canEditLayout: true, marqueeSelects: allOn });
});

const rows = () =>
  screen
    .getAllByTestId(/^select-mode-(cards|sections|links)$/)
    .map((row) => row.dataset.testid ?? "");

describe("the select-mode control", () => {
  it("should say what a box picks up while it is closed", () => {
    render(<SelectModeControl />);
    expect(screen.getByTestId("select-mode-toggle")).toHaveAttribute(
      "title",
      "Boxing picks up everything",
    );
  });

  it("should open to one toggle per thing, in the order they are offered", () => {
    render(<SelectModeControl />);
    fireEvent.click(screen.getByTestId("select-mode-toggle"));

    expect(rows()).toEqual(["select-mode-cards", "select-mode-sections", "select-mode-links"]);
    for (const row of rows())
      expect(screen.getByTestId(row)).toHaveAttribute("aria-pressed", "true");
  });

  it("should toggle one thing without touching the others", () => {
    render(<SelectModeControl />);
    fireEvent.click(screen.getByTestId("select-mode-toggle"));
    fireEvent.click(screen.getByTestId("select-mode-cards"));

    expect(useUiStore.getState().marqueeSelects).toEqual({
      cards: false,
      links: true,
      sections: true,
    });
  });

  it("should let a reader ask for sections and nothing else", () => {
    render(<SelectModeControl />);
    fireEvent.click(screen.getByTestId("select-mode-toggle"));
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

  /**
   * The last subject on cannot be switched off, and a dead row would be a worse answer than a
   * useful one: pressing it closes the menu and leaves the subject on.
   */
  it("should close the menu on the last subject rather than leave a box that picks up nothing", () => {
    render(<SelectModeControl />);
    fireEvent.click(screen.getByTestId("select-mode-toggle"));
    fireEvent.click(screen.getByTestId("select-mode-cards"));
    fireEvent.click(screen.getByTestId("select-mode-links"));

    const sections = screen.getByTestId("select-mode-sections");
    expect(sections).not.toBeDisabled();
    expect(sections).toHaveAttribute(
      "title",
      "Sections is the only thing a box picks up. Pressing this closes the menu",
    );

    fireEvent.click(sections);
    expect(useUiStore.getState().marqueeSelects).toEqual({
      cards: false,
      links: false,
      sections: true,
    });
    expect(screen.queryByTestId("select-mode-menu")).toBeNull();
  });

  /**
   * The pill that holds the toggle clips to its own radius, so the menu has to leave the DOM
   * tree it is anchored in. Asserted on the parent, because a `position: absolute` child of that
   * pill is a menu nobody can see — which is what shipped.
   */
  it("should draw its menu outside the control that owns it", () => {
    const { container } = render(<SelectModeControl />);
    fireEvent.click(screen.getByTestId("select-mode-toggle"));

    const menu = screen.getByTestId("select-mode-menu");
    expect(container.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
  });

  it("should close on Escape and on a press outside it", () => {
    render(<SelectModeControl />);

    fireEvent.click(screen.getByTestId("select-mode-toggle"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("select-mode-menu")).toBeNull();

    fireEvent.click(screen.getByTestId("select-mode-toggle"));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("select-mode-menu")).toBeNull();
  });

  it("should draw nothing for a viewer, who boxes nothing", () => {
    useUiStore.setState({ canEditLayout: false });
    const { container } = render(<SelectModeControl />);
    expect(container).toBeEmptyDOMElement();
  });
});
