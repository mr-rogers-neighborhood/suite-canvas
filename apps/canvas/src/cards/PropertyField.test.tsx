import type { FieldDefinition } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isPropertyEmpty, PropertyField } from "./PropertyField";

function field(overrides: Partial<FieldDefinition>): FieldDefinition {
  return {
    id: "f1",
    name: "Status",
    kind: "text",
    required: false,
    order: 0,
    options: [],
    ...overrides,
  };
}

describe("PropertyField", () => {
  it("should render a composing kind without the caller registering it", () => {
    // The registry is populated by importing the module that owns a kind, and
    // this component is the one place a field control passes through. Before
    // the import existed, a `rating` field rendered nothing at all.
    render(
      <PropertyField
        field={field({ name: "Score", kind: "rating", rating: { scale: 5 } })}
        value={3}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Score: 3 of 5")).toHaveAttribute("aria-pressed", "true");
  });

  it("should commit text on blur instead of every keystroke", () => {
    const onChange = vi.fn();
    render(<PropertyField field={field({})} value="idle" onChange={onChange} onClear={vi.fn()} />);

    const input = screen.getByLabelText("Status");
    fireEvent.change(input, { target: { value: "active" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("active");
  });

  it("should clear a text field when the draft becomes empty", () => {
    const onClear = vi.fn();
    render(<PropertyField field={field({})} value="idle" onChange={vi.fn()} onClear={onClear} />);

    const input = screen.getByLabelText("Status");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onClear).toHaveBeenCalled();
  });

  it("should toggle multi-select options without losing the others", () => {
    const onChange = vi.fn();
    const multi = field({
      kind: "multiSelect",
      options: [
        { id: "a", label: "Alpha", order: 0 },
        { id: "b", label: "Beta", order: 1 },
      ],
    });
    render(<PropertyField field={multi} value={["a"]} onChange={onChange} onClear={vi.fn()} />);

    fireEvent.click(screen.getByLabelText("Status: Beta"));
    expect(onChange).toHaveBeenCalledWith(["a", "b"]);
  });

  it("should treat blank values as empty for the required badge", () => {
    expect(isPropertyEmpty(undefined)).toBe(true);
    expect(isPropertyEmpty("  ")).toBe(true);
    expect(isPropertyEmpty([])).toBe(true);
    expect(isPropertyEmpty(false)).toBe(true);
    expect(isPropertyEmpty(true)).toBe(false);
    expect(isPropertyEmpty(0)).toBe(false);
  });
});

describe("PropertyField card kind", () => {
  const pickerCards = [
    { id: "c1", title: "Onboarding friction" },
    { id: "c2", title: "Pricing page rewrite" },
  ];
  const cardField = field({ kind: "card", name: "Contradicts" });

  it("should pick an existing card by title", () => {
    const onChange = vi.fn();
    render(
      <PropertyField
        field={cardField}
        value={undefined}
        onChange={onChange}
        onClear={vi.fn()}
        cards={pickerCards}
      />,
    );

    fireEvent.change(screen.getByLabelText("Contradicts"), { target: { value: "pricing" } });
    fireEvent.click(screen.getByRole("option", { name: "Pricing page rewrite" }));

    expect(onChange).toHaveBeenCalledWith("c2");
  });

  it("should select with the keyboard", () => {
    const onChange = vi.fn();
    render(
      <PropertyField
        field={cardField}
        value={undefined}
        onChange={onChange}
        onClear={vi.fn()}
        cards={pickerCards}
      />,
    );

    const input = screen.getByLabelText("Contradicts");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("c2");
  });

  it("should render a dangling value as unavailable", () => {
    render(
      <PropertyField
        field={cardField}
        value="purged-card"
        onChange={vi.fn()}
        onClear={vi.fn()}
        cards={pickerCards}
      />,
    );

    expect(screen.getByTestId("card-picker-selected")).toHaveTextContent("Unavailable card");
  });

  it("should clear a card value", () => {
    const onClear = vi.fn();
    render(
      <PropertyField
        field={cardField}
        value="c1"
        onChange={vi.fn()}
        onClear={onClear}
        cards={pickerCards}
      />,
    );

    expect(screen.getByTestId("card-picker-selected")).toHaveTextContent("Onboarding friction");
    fireEvent.click(screen.getByLabelText("Clear Contradicts"));

    expect(onClear).toHaveBeenCalled();
  });
});

describe("PropertyField per kind", () => {
  it("should commit a number as a number and clear an empty one", () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(
      <PropertyField
        field={field({ kind: "number", name: "Estimate" })}
        value={3}
        onChange={onChange}
        onClear={onClear}
      />,
    );

    const input = screen.getByLabelText("Estimate");
    expect(input).toHaveValue(3);
    fireEvent.change(input, { target: { value: "5.5" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(5.5);

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onClear).toHaveBeenCalled();
  });

  it("should commit a date and reject an empty one", () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(
      <PropertyField
        field={field({ kind: "date", name: "Due" })}
        value="2026-10-22"
        onChange={onChange}
        onClear={onClear}
      />,
    );

    const input = screen.getByLabelText("Due");
    fireEvent.change(input, { target: { value: "2026-11-01" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("2026-11-01");

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onClear).toHaveBeenCalled();
  });

  it("should show a deleted option as unavailable and let the user clear it", () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    const select = field({
      kind: "select",
      name: "Stage",
      options: [{ id: "a", label: "Alpha", order: 0 }],
    });
    render(<PropertyField field={select} value="gone" onChange={onChange} onClear={onClear} />);

    const input = screen.getByLabelText("Stage");
    expect(input).toHaveValue("gone");
    expect(screen.getByRole("option", { name: "Unavailable option" })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "" } });
    expect(onClear).toHaveBeenCalled();
  });

  it("should toggle a checkbox and clear it on uncheck", () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    const checkbox = field({ kind: "checkbox", name: "Done" });
    const { rerender } = render(
      <PropertyField field={checkbox} value={false} onChange={onChange} onClear={onClear} />,
    );

    fireEvent.click(screen.getByLabelText("Done"));
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(<PropertyField field={checkbox} value={true} onChange={onChange} onClear={onClear} />);
    fireEvent.click(screen.getByLabelText("Done"));
    expect(onClear).toHaveBeenCalled();
  });

  it("should clear a multi-select when its last option is removed", () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    const multi = field({
      kind: "multiSelect",
      name: "Labels",
      options: [{ id: "a", label: "Alpha", order: 0 }],
    });
    render(<PropertyField field={multi} value={["a"]} onChange={onChange} onClear={onClear} />);

    fireEvent.click(screen.getByLabelText("Labels: Alpha"));
    expect(onClear).toHaveBeenCalled();
  });

  it("should treat a deleted option or dangling card as empty for required fields", () => {
    const select = field({ kind: "select", name: "Stage", options: [] });
    expect(isPropertyEmpty("gone", select)).toBe(true);
    const card = field({ kind: "card", name: "Contradicts" });
    expect(isPropertyEmpty("missing", card, new Set(["c1"]))).toBe(true);
    expect(isPropertyEmpty("c1", card, new Set(["c1"]))).toBe(false);
  });

  it("should exclude the card being edited from a card picker", () => {
    const card = field({ kind: "card", name: "Contradicts" });
    render(
      <PropertyField
        field={card}
        value={undefined}
        onChange={vi.fn()}
        onClear={vi.fn()}
        cards={[
          { id: "c1", title: "Self" },
          { id: "c2", title: "Other" },
        ]}
        excludeCardId="c1"
      />,
    );

    fireEvent.change(screen.getByLabelText("Contradicts"), { target: { value: "o" } });
    expect(screen.getByRole("option", { name: "Other" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Self" })).not.toBeInTheDocument();
  });
});

describe("PropertyField board kind", () => {
  const boardField = field({ kind: "board", name: "Board", required: true });
  const boards = [{ id: "b1", name: "Research" }];

  it("should read a board value as the target's name, not its id", () => {
    render(
      <PropertyField
        field={boardField}
        value="b1"
        boards={boards}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByTestId("property-board-value")).toHaveTextContent("Research");
    expect(screen.queryByText("b1")).toBeNull();
  });

  it("should read a deleted board as unavailable", () => {
    render(
      <PropertyField
        field={boardField}
        value="gone"
        boards={boards}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    const value = screen.getByTestId("property-board-value");
    expect(value).toHaveTextContent("Unavailable board");
    expect(value).toHaveAttribute("title", "Unavailable board");
  });
});
