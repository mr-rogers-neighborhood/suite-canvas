import type { CardType } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
