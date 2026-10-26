import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardPicker } from "./CardPicker";

/**
 * The card picker is a combobox, not a menu.
 *
 * Its list is a `listbox` whose rows are `option`s, and the highlighted row is named
 * by `aria-activedescendant` while the text field keeps focus — the pattern that lets
 * a reader type and choose in one place. So `focusFirstMenuItem` does not apply here:
 * it looks for `menuitem` rows and moves focus out of the field, which would end the
 * query after the first keystroke. These tests hold that shape in place: the box keeps
 * focus, the arrows move the highlight, Enter picks, Escape puts the list away.
 */

const cards = [
  { id: "c1", title: "Alpha" },
  { id: "c2", title: "Beta" },
];

function open(): HTMLInputElement {
  const input = screen.getByRole<HTMLInputElement>("combobox", { name: "Source" });
  act(() => input.focus());
  fireEvent.focus(input);
  return input;
}

describe("CardPicker", () => {
  it("keeps focus in the search box while the list is open", () => {
    render(<CardPicker cards={cards} label="Source" onChange={() => {}} onClear={() => {}} />);

    const input = open();

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("names the highlighted row for a screen reader as the arrows move", () => {
    render(<CardPicker cards={cards} label="Source" onChange={() => {}} onClear={() => {}} />);
    const input = open();

    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getByText("Beta").id);
  });

  it("picks the highlighted card on Enter", () => {
    const onChange = vi.fn();
    render(<CardPicker cards={cards} label="Source" onChange={onChange} onClear={() => {}} />);
    const input = open();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("c2");
  });

  it("puts the list away on Escape without losing the field", () => {
    render(<CardPicker cards={cards} label="Source" onChange={() => {}} onClear={() => {}} />);
    const input = open();

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input).toBeInTheDocument();
  });
});
