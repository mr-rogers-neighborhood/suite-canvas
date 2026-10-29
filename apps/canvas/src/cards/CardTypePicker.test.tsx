import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CardTypePicker } from "./CardTypePicker";
import { ensureWhiteboardType } from "./whiteboard";

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

/**
 * A behaviour owns a renderer and its own record, so it is never one of a card's
 * extra types. The list is a fact about the model (`isBehaviourType`), which is
 * why this is pinned here rather than in each surface.
 */
describe("CardTypePicker and behaviour types", () => {
  function withBehaviours() {
    const built = fixture();
    // Both behaviours a reader can meet in a card list: the sketch type boot
    // creates, and the portal the seed ships.
    ensureWhiteboardType(built.workspace);
    return { ...built, types: built.workspace.listTypes() };
  }

  it("never offers a sketch or a portal as an extra type", () => {
    const { card, primary, types } = withBehaviours();
    render(
      <CardTypePicker
        card={card}
        types={types}
        orderedIds={[primary.id]}
        onSetPrimary={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
        onManage={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("type-add"));

    expect(screen.queryByTestId("type-option-whiteboard")).toBeNull();
    expect(screen.queryByTestId("type-option-portal")).toBeNull();
    // An authored type is still offered: this is about behaviours, not about
    // narrowing the picker.
    expect(screen.getByTestId("type-option-concept")).toBeInTheDocument();
  });

  it("does not offer a behaviour as a new primary type", () => {
    const { card, primary, types } = withBehaviours();
    const authored = types.find((type) => type.id === "note" && type.id !== primary.id) ?? primary;
    render(
      <CardTypePicker
        card={card}
        types={types}
        orderedIds={[authored.id]}
        onSetPrimary={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
        onManage={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("type-primary-menu"));

    expect(screen.queryByTestId("type-primary-option-whiteboard")).toBeNull();
  });

  it("offers no member at all on a card that is a sketch", () => {
    const { workspace, types } = withBehaviours();
    const board = workspace.ensureBoard();
    const sketch = workspace.createCard({
      boardId: board.id,
      typeId: "whiteboard",
      position: { x: 0, y: 0 },
    });
    render(
      <CardTypePicker
        card={sketch}
        types={types}
        orderedIds={["whiteboard"]}
        onSetPrimary={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
        onManage={() => {}}
      />,
    );

    // The chip names it, and nothing offers to make it a note-on-top-of-sketch.
    expect(screen.getByTestId("type-primary-whiteboard")).toBeInTheDocument();
    expect(screen.queryByTestId("type-add")).toBeNull();
    expect(screen.queryByTestId("type-primary-menu")).toBeNull();
  });
});
