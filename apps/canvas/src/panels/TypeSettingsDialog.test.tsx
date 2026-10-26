import type { CardType } from "@suite/graph";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { TypeSettingsDialog } from "./TypeSettingsDialog";

const type: CardType = {
  id: "type-1",
  name: "Recipe",
  glyph: "◆",
  createdAt: 0,
  updatedAt: 0,
  fields: [],
};

function renderDialog(onAddField = vi.fn()) {
  render(
    <TypeSettingsDialog
      types={[type]}
      onClose={() => {}}
      onCreateType={() => "type-2"}
      onUpdateType={() => {}}
      onDeleteType={() => {}}
      onAddField={onAddField}
      onUpdateField={() => {}}
      onRemoveField={() => {}}
      onMoveField={() => {}}
      onAddOption={() => {}}
      onUpdateOption={() => {}}
      onRemoveOption={() => {}}
      templateFor={() => undefined}
      onCreateTemplate={() => {}}
      onOpenTemplate={() => {}}
      onClearTemplate={() => {}}
    />,
  );
  return onAddField;
}

describe("the type editor's composite fields", () => {
  it("does not ask for sub-fields of a plain field", () => {
    renderDialog();
    expect(screen.queryByTestId("sub-field-editor")).toBeNull();
    expect(screen.queryByTestId("rating-shape")).toBeNull();
  });

  it("creates a group with the sub-fields the author declared", () => {
    const onAddField = renderDialog();
    fireEvent.change(screen.getByLabelText("New field name"), { target: { value: "Source" } });
    fireEvent.change(screen.getByLabelText("New field kind"), { target: { value: "group" } });

    fireEvent.click(screen.getByTestId("add-sub-field"));
    fireEvent.click(screen.getByTestId("add-sub-field"));
    fireEvent.change(screen.getByTestId("sub-field-name-0"), { target: { value: "Author" } });
    fireEvent.change(screen.getByTestId("sub-field-name-1"), { target: { value: "Year" } });
    fireEvent.change(screen.getByTestId("sub-field-kind-1"), { target: { value: "number" } });

    fireEvent.click(screen.getByTestId("create-field"));

    // Without this the field renders "no sub-fields yet" and looks broken; the
    // shape is what makes a composite field a field at all (ADR-0057 §6).
    expect(onAddField).toHaveBeenCalledWith("type-1", {
      name: "Source",
      kind: "group",
      subFields: [
        { name: "Author", kind: "text" },
        { name: "Year", kind: "number" },
      ],
      itemKind: "scalar",
    });
  });

  it("creates a rating with its scale, and refuses a blank sub-field", () => {
    const onAddField = renderDialog();
    fireEvent.change(screen.getByLabelText("New field name"), { target: { value: "Score" } });
    fireEvent.change(screen.getByLabelText("New field kind"), { target: { value: "rating" } });
    fireEvent.change(screen.getByTestId("rating-scale"), { target: { value: "10" } });
    fireEvent.click(screen.getByTestId("rating-half"));
    fireEvent.click(screen.getByTestId("create-field"));

    expect(onAddField).toHaveBeenCalledWith("type-1", {
      name: "Score",
      kind: "rating",
      rating: { scale: 10, half: true },
    });

    fireEvent.change(screen.getByLabelText("New field name"), { target: { value: "Steps" } });
    fireEvent.change(screen.getByLabelText("New field kind"), { target: { value: "list" } });
    fireEvent.click(screen.getByTestId("add-sub-field"));
    // A row nobody named is not a sub-field.
    expect(screen.getByTestId("create-field")).toBeEnabled();
    fireEvent.click(screen.getByTestId("create-field"));
    expect(onAddField).toHaveBeenLastCalledWith("type-1", {
      name: "Steps",
      kind: "list",
      subFields: [],
      itemKind: "scalar",
    });
  });
});

/** The real workspace document, so the card count is the count the write sees. */
function recipeWithCards(cards: number) {
  const workspace = useCanvasStore.getState().workspace;
  workspace.ensureDefaultTypes();
  const recipe = workspace.createType({ name: "Recipe", glyph: "\u25c6" });
  for (let index = 0; index < cards; index += 1) workspace.createCard({ typeId: recipe.id });
  const note = workspace.listTypes().find((entry) => entry.id === "note");
  return {
    recipe,
    note,
    types: [recipe, ...workspace.listTypes().filter((t) => t.id !== recipe.id)],
  };
}

function renderDeleteType(types: CardType[], onDeleteType = vi.fn()) {
  render(
    <TypeSettingsDialog
      types={types}
      onClose={() => {}}
      onCreateType={() => "type-2"}
      onUpdateType={() => {}}
      onDeleteType={onDeleteType}
      onAddField={() => {}}
      onUpdateField={() => {}}
      onRemoveField={() => {}}
      onMoveField={() => {}}
      onAddOption={() => {}}
      onUpdateOption={() => {}}
      onRemoveOption={() => {}}
      templateFor={() => undefined}
      onCreateTemplate={() => {}}
      onOpenTemplate={() => {}}
      onClearTemplate={() => {}}
    />,
  );
  return onDeleteType;
}

/**
 * Deleting a type silently re-homed every card that used it. The confirmation
 * says how many cards move, because that is the part of the write the reader
 * cannot see in the type list.
 */
describe("the type editor's delete", () => {
  it("asks first, and says how many cards get re-homed", () => {
    const { recipe, note, types } = recipeWithCards(2);
    const onDeleteType = renderDeleteType(types);

    fireEvent.click(screen.getByTestId("delete-type"));

    expect(onDeleteType).not.toHaveBeenCalled();
    expect(screen.getByTestId("dialog")).toHaveTextContent("2 cards use it, and move to Note.");

    fireEvent.click(
      within(screen.getByTestId("dialog")).getByRole("button", { name: "Delete type" }),
    );

    expect(onDeleteType).toHaveBeenCalledWith(recipe.id, note?.id);
  });

  it("counts one card as one card", () => {
    const { types } = recipeWithCards(1);
    renderDeleteType(types);

    fireEvent.click(screen.getByTestId("delete-type"));

    expect(screen.getByTestId("dialog")).toHaveTextContent("1 card uses it, and moves to Note.");
  });

  it("says so when no card uses the type", () => {
    const { types } = recipeWithCards(0);
    renderDeleteType(types);

    fireEvent.click(screen.getByTestId("delete-type"));

    expect(screen.getByTestId("dialog")).toHaveTextContent("No cards use it.");
  });

  it("deletes nothing when the reader cancels", () => {
    const { types } = recipeWithCards(1);
    const onDeleteType = renderDeleteType(types);

    fireEvent.click(screen.getByTestId("delete-type"));
    fireEvent.click(within(screen.getByTestId("dialog")).getByRole("button", { name: "Cancel" }));

    expect(onDeleteType).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dialog")).toBeNull();
  });
});
