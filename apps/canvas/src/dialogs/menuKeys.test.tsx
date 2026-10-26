import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { menuKeyDown } from "./menuKeys";

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
