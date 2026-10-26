import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { focusFirstMenuItem, menuKeyDown } from "./menuKeys";

function Menu() {
  return (
    <div role="menu" aria-label="Test menu" onKeyDown={menuKeyDown}>
      <button type="button" role="menuitem" data-testid="one">
        One
      </button>
      <div role="menu" aria-label="Nested">
        <button type="button" role="menuitem" data-testid="nested">
          Nested
        </button>
      </div>
      <button type="button" role="menuitem" data-testid="two">
        Two
      </button>
      <button type="button" role="menuitem" disabled data-testid="disabled">
        Disabled
      </button>
    </div>
  );
}

describe("menuKeyDown", () => {
  it("moves between the items of one menu and skips a nested menu's rows", () => {
    render(<Menu />);
    const one = screen.getByTestId("one");
    const two = screen.getByTestId("two");

    one.focus();
    fireEvent.keyDown(one, { key: "ArrowDown" });
    expect(two).toHaveFocus();

    fireEvent.keyDown(two, { key: "ArrowDown" });
    expect(one).toHaveFocus();

    fireEvent.keyDown(one, { key: "ArrowUp" });
    expect(two).toHaveFocus();
  });

  it("jumps to the ends with Home and End", () => {
    render(<Menu />);
    const one = screen.getByTestId("one");
    const two = screen.getByTestId("two");

    one.focus();
    fireEvent.keyDown(one, { key: "End" });
    expect(two).toHaveFocus();

    fireEvent.keyDown(two, { key: "Home" });
    expect(one).toHaveFocus();
  });

  it("leaves other keys alone", () => {
    render(<Menu />);
    const one = screen.getByTestId("one");

    one.focus();
    fireEvent.keyDown(one, { key: "Tab" });

    expect(one).toHaveFocus();
  });
});

/** A trigger and a menu that opens under it, the shape every menu in the shell has. */
function Disclosure() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" data-testid="trigger" onClick={() => setOpen((value) => !value)}>
        Open
      </button>
      <button type="button" data-testid="dismiss" onClick={() => setOpen(false)}>
        Dismiss
      </button>
      {open ? (
        <div ref={focusFirstMenuItem} role="menu" aria-label="Test menu" onKeyDown={menuKeyDown}>
          <button type="button" role="menuitem" data-testid="first">
            First
          </button>
          <button type="button" role="menuitemradio" aria-checked={false} data-testid="second">
            Second
          </button>
        </div>
      ) : null}
    </div>
  );
}

describe("focusFirstMenuItem", () => {
  it("moves focus into the menu as it opens, so the arrows can arrive", () => {
    render(<Disclosure />);
    const trigger = screen.getByTestId("trigger");
    trigger.focus();

    fireEvent.click(trigger);

    expect(screen.getByTestId("first")).toHaveFocus();
  });

  it("counts a menuitemradio as an item", () => {
    render(<Disclosure />);
    fireEvent.click(screen.getByTestId("trigger"));

    fireEvent.keyDown(screen.getByTestId("first"), { key: "ArrowDown" });

    expect(screen.getByTestId("second")).toHaveFocus();
  });

  it("hands focus back to the trigger when the menu closes from inside it", () => {
    render(<Disclosure />);
    const trigger = screen.getByTestId("trigger");
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByTestId("first")).toHaveFocus();

    // An outside press or Escape unmounts the row that had focus, and the
    // browser would otherwise leave focus on `<body>`.
    fireEvent.click(screen.getByTestId("dismiss"));

    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
