import type { FieldDefinition } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "./compositeKinds";
import { fieldKindEntry, formatFieldValue, registeredFieldKinds } from "./fieldKindRegistry";

function field(overrides: Partial<FieldDefinition>): FieldDefinition {
  return {
    id: "f1",
    name: "Field",
    kind: "text",
    required: false,
    order: 0,
    options: [],
    ...overrides,
  };
}

const groupField = field({
  id: "where",
  name: "Where I left off",
  kind: "group",
  subFields: [
    { id: "chapter", name: "Chapter", kind: "text", order: 0 },
    { id: "page", name: "Page", kind: "number", order: 1 },
  ],
});

const listField = field({
  id: "steps",
  name: "Steps",
  kind: "list",
  itemKind: "scalar",
  subFields: [{ id: "item", name: "Step", kind: "text", order: 0 }],
});

const groupListField = field({
  id: "ingredients",
  name: "Ingredients",
  kind: "list",
  itemKind: "group",
  subFields: [
    { id: "item", name: "Item", kind: "text", order: 0 },
    { id: "amount", name: "Amount", kind: "number", order: 1 },
  ],
});

function editor(kind: string) {
  const entry = fieldKindEntry(kind);
  if (!entry) throw new Error(`Kind "${kind}" is not registered`);
  return entry.editor;
}

describe("composing field kinds", () => {
  it("should register all three kinds when the module is imported", () => {
    expect(registeredFieldKinds()).toEqual(["group", "list", "rating"]);
  });

  it("should write a rating as a number and read it back with its scale", () => {
    const Rating = editor("rating");
    const onCommit = vi.fn();
    render(
      <Rating
        field={field({ name: "Score", kind: "rating", rating: { scale: 10 } })}
        value={undefined}
        onCommit={onCommit}
      />,
    );

    fireEvent.click(screen.getByLabelText("Score: 7 of 10"));

    expect(onCommit).toHaveBeenCalledWith(7);
    expect(formatFieldValue("rating", 7, field({ kind: "rating", rating: { scale: 10 } }))).toBe(
      "7/10",
    );
  });

  it("should offer half steps only when the field declares them", () => {
    const Rating = editor("rating");
    render(
      <Rating
        field={field({ name: "Score", kind: "rating", rating: { scale: 5, half: true } })}
        value={2.5}
        onCommit={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Score: 2.5 of 5")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("button")).toHaveLength(11);
  });

  it("should commit the whole group when one sub-value changes", () => {
    const Group = editor("group");
    const onCommit = vi.fn();
    render(<Group field={groupField} value={{ chapter: "One" }} onCommit={onCommit} />);

    fireEvent.change(screen.getByLabelText("Page"), { target: { value: "12" } });
    fireEvent.blur(screen.getByLabelText("Page"));

    expect(onCommit).toHaveBeenCalledWith({ chapter: "One", page: 12 });
    expect(formatFieldValue("group", { chapter: "One" }, groupField)).toBe("1/2 filled");
  });

  it("should append, edit and remove list rows while committing an array", () => {
    const List = editor("list");
    const onCommit = vi.fn();
    const { rerender } = render(<List field={listField} value={[]} onCommit={onCommit} />);

    fireEvent.click(screen.getByText("Add item"));
    expect(onCommit).toHaveBeenCalledWith([""]);

    rerender(<List field={listField} value={["Mix", "Bake"]} onCommit={onCommit} />);
    fireEvent.click(screen.getByLabelText("Remove Steps item 1"));
    expect(onCommit).toHaveBeenLastCalledWith(["Bake"]);
    expect(formatFieldValue("list", ["Mix", "Bake"])).toBe("2 items");
  });

  it("should edit a list of groups row by row", () => {
    const List = editor("list");
    const onCommit = vi.fn();
    render(
      <List field={groupListField} value={[{ item: "Flour", amount: 200 }]} onCommit={onCommit} />,
    );

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "250" } });
    fireEvent.blur(screen.getByLabelText("Amount"));

    expect(onCommit).toHaveBeenCalledWith([{ item: "Flour", amount: 250 }]);
  });

  it("should clear the property when the last list row is removed", () => {
    const List = editor("list");
    const onCommit = vi.fn();
    render(<List field={listField} value={["Mix"]} onCommit={onCommit} />);

    fireEvent.click(screen.getByLabelText("Remove Steps item 1"));

    expect(onCommit).toHaveBeenCalledWith(null);
  });
});
