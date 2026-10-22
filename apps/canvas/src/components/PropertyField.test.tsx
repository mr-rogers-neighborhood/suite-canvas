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
