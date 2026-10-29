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
      templatesFor={() => []}
      templateCandidatesFor={() => []}
      onCreateTemplate={() => {}}
      onOpenTemplate={() => {}}
      onSetTemplates={() => {}}
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
      templatesFor={() => []}
      templateCandidatesFor={() => []}
      onCreateTemplate={() => {}}
      onOpenTemplate={() => {}}
      onSetTemplates={() => {}}
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

describe("the type editor's shape", () => {
  const behaviourType = (id: string, name: string): CardType => ({
    id,
    name,
    glyph: "◇",
    createdAt: 0,
    updatedAt: 0,
    fields: [],
  });

  function renderWith(
    types: CardType[],
    props: Partial<Parameters<typeof TypeSettingsDialog>[0]> = {},
  ) {
    render(
      <TypeSettingsDialog
        types={types}
        onClose={() => {}}
        onCreateType={() => "type-2"}
        onUpdateType={() => {}}
        onDeleteType={() => {}}
        onAddField={() => {}}
        onUpdateField={() => {}}
        onRemoveField={() => {}}
        onMoveField={() => {}}
        onAddOption={() => {}}
        onUpdateOption={() => {}}
        onRemoveOption={() => {}}
        templatesFor={() => []}
        templateCandidatesFor={() => []}
        onCreateTemplate={() => {}}
        onOpenTemplate={() => {}}
        onSetTemplates={() => {}}
        {...props}
      />,
    );
  }

  it("does not offer the types the runtime draws as things to author", () => {
    renderWith([
      type,
      behaviourType("portal", "Portal"),
      behaviourType("whiteboard", "Sketch"),
      behaviourType("tutorial", "Tour"),
    ]);

    expect(screen.getByTestId("settings-type-type-1")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-type-portal")).toBeNull();
    expect(screen.queryByTestId("settings-type-whiteboard")).toBeNull();
    expect(screen.queryByTestId("settings-type-tutorial")).toBeNull();
    // The note that explained the read-only rows has nothing left to explain.
    expect(screen.queryByTestId("type-readonly-note")).toBeNull();
  });

  it("opens on Fields, and leaves the look and the template folded away", () => {
    renderWith([type], {
      templatesFor: () => [{ id: "card-1", title: "An example" }],
    });

    expect(screen.getByTestId("type-fields")).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("type-appearance")).not.toHaveAttribute("data-open");
    expect(screen.getByTestId("type-template-section")).not.toHaveAttribute("data-open");
    // Folded means folded: the controls inside are not in the tree at all.
    expect(screen.queryByTestId("type-template-open")).toBeNull();
    expect(screen.queryByTestId("style-tab")).toBeNull();

    fireEvent.click(screen.getByTestId("type-template-section-toggle"));
    expect(screen.getByTestId("type-template-open")).toBeInTheDocument();
  });

  it("orders the sections Fields, then Appearance, then Template", () => {
    renderWith([type]);
    const headings = [
      "type-fields-toggle",
      "type-appearance-toggle",
      "type-template-section-toggle",
    ].map((id) => screen.getByTestId(id));
    for (let index = 1; index < headings.length; index += 1) {
      const previous = headings[index - 1];
      const current = headings[index];
      if (!previous || !current) throw new Error("missing heading");
      expect(
        previous.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("lists the templates in order and marks the first as the one new cards use", () => {
    renderWith([type], {
      templatesFor: () => [
        { id: "card-1", title: "Sourdough" },
        { id: "card-2", title: "Focaccia" },
      ],
    });

    fireEvent.click(screen.getByTestId("type-template-section-toggle"));
    const rows = screen.getAllByTestId("type-template-row");
    expect(rows.map((row) => row.textContent)).toEqual([
      // The first says what it is; the second offers to become it.
      expect.stringContaining("Sourdough"),
      expect.stringContaining("Focaccia"),
    ]);
    expect(within(rows[0] as HTMLElement).getByTestId("type-template-default")).toHaveTextContent(
      "Used for new cards",
    );
    expect(within(rows[1] as HTMLElement).queryByTestId("type-template-default")).toBeNull();
    expect(within(rows[1] as HTMLElement).getByTestId("type-template-promote")).toBeVisible();
  });

  it("promotes a template, removes one, and appends a card that already exists", () => {
    const onSetTemplates = vi.fn();
    renderWith([type], {
      templatesFor: () => [
        { id: "card-1", title: "Sourdough" },
        { id: "card-2", title: "Focaccia" },
      ],
      templateCandidatesFor: () => [
        { id: "card-1", title: "Sourdough" },
        { id: "card-2", title: "Focaccia" },
        { id: "card-3", title: "Ciabatta" },
      ],
      onSetTemplates,
    });

    fireEvent.click(screen.getByTestId("type-template-section-toggle"));
    fireEvent.click(screen.getAllByTestId("type-template-promote")[0] as HTMLElement);
    expect(onSetTemplates).toHaveBeenCalledWith("type-1", ["card-2", "card-1"]);

    fireEvent.click(screen.getAllByTestId("type-template-remove")[0] as HTMLElement);
    expect(onSetTemplates).toHaveBeenCalledWith("type-1", ["card-2"]);

    // A card that is already a template is not offered twice.
    const picker = screen.getByTestId("type-template-pick");
    expect(within(picker).queryByRole("option", { name: "Sourdough" })).toBeNull();
    fireEvent.change(picker, { target: { value: "card-3" } });
    expect(onSetTemplates).toHaveBeenCalledWith("type-1", ["card-1", "card-2", "card-3"]);
  });
});
