import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CardTypePicker } from "./CardTypePicker";

function fixture() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const card = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  const types = workspace.listTypes();
  const [primary, ...rest] = types;
  if (primary === undefined) throw new Error("the workspace has no types");
  return { workspace, card, primary, rest };
}

/**
 * Both pickers declared `role="menu"` and left focus on the chip that opened
 * them, so their arrow handlers were unreachable and the menus were Tab-only.
 */
describe("CardTypePicker menus", () => {
  it("takes focus on the first type when the primary menu opens", () => {
    const { card, primary, rest } = fixture();
    render(
      <CardTypePicker
        card={card}
        types={[primary, ...rest]}
        orderedIds={[primary.id]}
        onSetPrimary={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
        onManage={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("type-primary-menu"));

    const other = rest[0];
    if (other === undefined) throw new Error("no other type to offer");
    expect(screen.getByTestId(`type-primary-option-${other.id}`)).toHaveFocus();
  });

  it("takes focus on the first addable type when the add menu opens", () => {
    const { card, primary, rest } = fixture();
    render(
      <CardTypePicker
        card={card}
        types={[primary, ...rest]}
        orderedIds={[primary.id]}
        onSetPrimary={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
        onManage={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("type-add"));

    const other = rest[0];
    if (other === undefined) throw new Error("no other type to add");
    expect(screen.getByTestId(`type-option-${other.id}`)).toHaveFocus();
  });
});
