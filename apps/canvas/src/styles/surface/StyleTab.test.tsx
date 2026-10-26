import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "../../store/useCanvasStore";
import { StyleTab } from "./StyleTab";

/**
 * One editor, every surface (ADR-0051). These tests pin down the two things that
 * differ per kind — a box has four sides and a shape, a link has one stroke and
 * neither — and that every control writes through the typed document layer.
 */

beforeEach(() => {
  useCanvasStore.setState({ workspace: new WorkspaceDocument() });
});

function workspace(): WorkspaceDocument {
  return useCanvasStore.getState().workspace;
}

/** A card on a board, which is what every styled surface needs to exist first. */
function seed() {
  const doc = workspace();
  const board = doc.createBoard({ name: "Home" });
  const card = doc.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  const section = doc.createSection({
    boardId: board.id,
    title: "Act one",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
  });
  return { doc, board, card, section };
}

describe("StyleTab for a box", () => {
  it("offers a silhouette and four sides, and writes them to the card", () => {
    const { doc, card } = seed();
    render(<StyleTab kind="card" id={card.id} canEdit />);

    expect(screen.getByTestId("style-shapes")).toBeTruthy();
    expect(screen.getByTestId("style-side-top")).toBeTruthy();

    fireEvent.click(screen.getByTestId("style-shape-diamond"));
    expect(doc.getCard(card.id)?.style?.shape).toBe("diamond");

    fireEvent.change(screen.getByTestId("style-side-left"), { target: { value: "dashed" } });
    expect(doc.getCard(card.id)?.style?.sides?.left?.paint).toBe("dashed");

    // A side set back to solid is dropped rather than stored as a default.
    fireEvent.change(screen.getByTestId("style-side-left"), { target: { value: "solid" } });
    expect(doc.getCard(card.id)?.style?.sides?.left).toBeUndefined();
  });

  it("names the rung an Inherit would fall back to, instead of the bare word", () => {
    const { doc, card } = seed();
    // A type rule that paints every card of this card's type: the thing an empty control
    // actually falls back to, and the thing "Inherit" used to leave unstated (ADR-0071).
    const typeId = doc.getCard(card.id)?.primaryTypeId;
    if (!typeId) throw new Error("the seeded card has no type");
    doc.setStyleRules([
      {
        id: "rule-1",
        name: "Concept paint",
        order: 0,
        scope: { kind: "type", id: typeId },
        style: { surface: "canvas" },
      },
    ]);
    const typeName = doc.getType(typeId)?.name ?? "this type";

    render(<StyleTab kind="card" id={card.id} canEdit />);

    const option = screen
      .getByTestId("style-surface")
      .querySelector('option[value=""]') as HTMLOptionElement | null;
    expect(option?.textContent).toBe(`Inherit from ${typeName}`);
  });

  it("leaves Inherit plain when no rule has an opinion", () => {
    const { card } = seed();
    render(<StyleTab kind="card" id={card.id} canEdit />);

    const option = screen
      .getByTestId("style-surface")
      .querySelector('option[value=""]') as HTMLOptionElement | null;
    // "Inherit from the default" is longer and says no more.
    expect(option?.textContent).toBe("Inherit");
  });

  it("styles a section through the same editor", () => {
    const { doc, section } = seed();
    render(<StyleTab kind="section" id={section.id} canEdit />);

    fireEvent.click(screen.getByTestId("style-shape-pill"));

    expect(doc.getSection(section.id)?.style?.shape).toBe("pill");
  });

  it("styles a board through the same editor", () => {
    const { doc, board } = seed();
    render(<StyleTab kind="board" id={board.id} canEdit />);

    fireEvent.change(screen.getByTestId("style-surface"), { target: { value: "canvas" } });

    expect(doc.getBoard(board.id)?.style?.surface).toBe("canvas");
  });

  it("writes nothing when the reader may not edit", () => {
    const { doc, card } = seed();
    render(<StyleTab kind="card" id={card.id} canEdit={false} />);

    fireEvent.click(screen.getByTestId("style-shape-circle"));

    expect(doc.getCard(card.id)?.style).toBeUndefined();
  });
});

describe("StyleTab for a link", () => {
  it("offers one stroke instead of four sides, and no silhouette", () => {
    const { doc, board, card } = seed();
    const other = doc.createCard({ boardId: board.id, position: { x: 400, y: 0 } });
    const edge = doc.addEdge({ boardId: board.id, source: card.id, target: other.id });
    if (!edge) throw new Error("link was not created");

    render(<StyleTab kind="edge" id={edge.id} canEdit />);

    // A line cannot wear a silhouette or hold text, so those controls are absent
    // rather than present-and-inert.
    expect(screen.queryByTestId("style-shapes")).toBeNull();
    expect(screen.queryByTestId("style-text-scale")).toBeNull();
    expect(screen.queryByTestId("style-surface")).toBeNull();
    expect(screen.getByTestId("style-line-paint")).toBeTruthy();
    expect(screen.getByTestId("style-opacity")).toBeTruthy();

    // The line style is stored on the same per-side record every surface uses, at
    // `top`: a stroke is a link's only edge.
    fireEvent.change(screen.getByTestId("style-line-paint"), { target: { value: "dashed" } });
    expect(doc.getEdge(edge.id)?.style?.sides?.top?.paint).toBe("dashed");

    fireEvent.change(screen.getByTestId("style-line-flow"), { target: { value: "reverse" } });
    expect(doc.getEdge(edge.id)?.style?.sides?.top).toEqual({ paint: "dashed", flow: "reverse" });
  });
});

/**
 * The scope picker (ADR-0071
 * amendment). Two promises matter and both are about *not* writing: switching the scope is free, and the
 * rule appears only when the reader actually changes something.
 */
describe("StyleTab scope picker", () => {
  /** A card with a type of its own, so "every Concept" is on offer. */
  function typed() {
    const seeded = seed();
    // The card is created with the default note type, so the type comes from the card rather than from a
    // second lookup that could disagree with it.
    seeded.doc.ensureDefaultTypes();
    const typeId = seeded.doc.getCard(seeded.card.id)?.primaryTypeId;
    const type = seeded.doc.listTypes().find((entry) => entry.id === typeId);
    if (!type) throw new Error("the card has no type");
    return { ...seeded, type };
  }

  it("offers the rungs a card can reach, and only those", () => {
    const { card, type } = typed();
    render(<StyleTab kind="card" id={card.id} canEdit typeId={type.id} typeName={type.name} />);

    const options = [...screen.getByTestId("style-scope-select").querySelectorAll("option")].map(
      (option) => option.textContent,
    );
    expect(options).toEqual([
      "this card",
      `every ${type.name}`,
      "every card",
      "everywhere in this workspace",
    ]);
  });

  it("does not offer a type rung to something with no type", () => {
    const { section } = seed();
    render(<StyleTab kind="section" id={section.id} canEdit typeId={null} />);

    const options = [...screen.getByTestId("style-scope-select").querySelectorAll("option")].map(
      (option) => option.textContent,
    );
    expect(options).not.toContain("every card of this type");
    expect(options).toContain("this section");
  });

  it("writes nothing when the scope changes, and says so", () => {
    const { doc, card, type } = typed();
    render(<StyleTab kind="card" id={card.id} canEdit typeId={type.id} typeName={type.name} />);

    fireEvent.change(screen.getByTestId("style-scope-select"), {
      target: { value: `type:${type.id}` },
    });

    // Browsing the ladder must not litter the document with rules that name nothing.
    expect(doc.styleRules()).toEqual([]);
    expect(screen.getByTestId("style-scope-note")).toHaveTextContent(
      "Choosing a scope on its own changes nothing",
    );
  });

  it("creates the rule on the first change, named for its scope and ordered last", () => {
    const { doc, card, type } = typed();
    doc.setStyleRules([
      {
        id: "r-existing",
        name: "Everywhere",
        order: 0,
        scope: { kind: "global" },
        style: { radius: 2 },
      },
    ]);
    render(<StyleTab kind="card" id={card.id} canEdit typeId={type.id} typeName={type.name} />);

    fireEvent.change(screen.getByTestId("style-scope-select"), {
      target: { value: `type:${type.id}` },
    });
    fireEvent.click(screen.getByTestId("style-shape-diamond"));

    const rules = doc.styleRules();
    const created = rules.find((rule) => rule.scope.kind === "type");
    expect(created).toBeDefined();
    expect(created?.name).toBe(`Every ${type.name}`);
    expect(created?.scope).toEqual({ kind: "type", id: type.id });
    expect(created?.style.shape).toBe("diamond");
    // After the rule that already existed: a new edit must not win against what was already in force.
    expect(created?.order).toBeGreaterThan(0);
    // And the card itself is untouched — this edited the rule, not the card.
    expect(doc.getCard(card.id)?.style).toBeUndefined();
  });

  it("edits one rule rather than a second one for the same scope", () => {
    const { doc, card, type } = typed();
    render(<StyleTab kind="card" id={card.id} canEdit typeId={type.id} typeName={type.name} />);

    const select = screen.getByTestId("style-scope-select");
    fireEvent.change(select, { target: { value: `type:${type.id}` } });
    fireEvent.click(screen.getByTestId("style-shape-diamond"));
    fireEvent.change(select, { target: { value: "surface" } });
    fireEvent.change(select, { target: { value: `type:${type.id}` } });
    fireEvent.click(screen.getByTestId("style-shape-pill"));

    const typed_ = doc.styleRules().filter((rule) => rule.scope.kind === "type");
    expect(typed_).toHaveLength(1);
    expect(typed_[0]?.style.shape).toBe("pill");
  });
});

/**
 * Promoting a card's style into a rule (ADR-0071
 * amendment). The confirm has to name the cards it will actually change, and the write must not strip
 * anyone's own style — otherwise "apply to every Concept" quietly deletes the exceptions that made the
 * board readable.
 */
describe("StyleTab promotion", () => {
  function boardWithCards() {
    const seeded = seed();
    seeded.doc.ensureDefaultTypes();
    const typeId = seeded.doc.getCard(seeded.card.id)?.primaryTypeId;
    if (!typeId) throw new Error("the card has no type");
    // A second and third card of the same type: one bare, one with a style of its own.
    const bare = seeded.doc.createCard({ boardId: seeded.board.id, position: { x: 400, y: 0 } });
    const styled = seeded.doc.createCard({ boardId: seeded.board.id, position: { x: 800, y: 0 } });
    seeded.doc.setCardStyle(styled.id, { radius: 3 });
    return { ...seeded, typeId, bare, styled };
  }

  it("is not offered until the card has a style of its own", () => {
    const { card } = boardWithCards();
    render(<StyleTab kind="card" id={card.id} canEdit />);
    // There is nothing to promote yet, so the control would be a button that does nothing.
    expect(screen.queryByTestId("style-promote")).toBeNull();
  });

  it("names how many cards actually change, not the type's population", () => {
    const { doc, card, typeId } = boardWithCards();
    doc.setCardStyle(card.id, { shape: "pill" });
    render(<StyleTab kind="card" id={card.id} canEdit typeId={typeId} typeName="Note" />);

    fireEvent.click(screen.getByTestId("style-promote"));

    // Three Notes exist. One has a style of its own and keeps it; the other is the card being promoted,
    // which already looks like this. So exactly one card's appearance changes — and saying "3 cards" would
    // be a promise the write does not keep.
    expect(screen.getByTestId("dialog")).toHaveTextContent("1 card of this type");
    expect(screen.getByTestId("dialog")).toHaveTextContent("keep it");
  });

  it("writes the rule and leaves every card's own style alone", () => {
    const { doc, card, styled, typeId } = boardWithCards();
    doc.setCardStyle(card.id, { shape: "pill" });
    render(<StyleTab kind="card" id={card.id} canEdit typeId={typeId} typeName="Note" />);

    fireEvent.click(screen.getByTestId("style-promote"));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    const rule = doc.styleRules().find((entry) => entry.scope.kind === "type");
    expect(rule?.name).toBe("Every Note");
    expect(rule?.style.shape).toBe("pill");
    // The exception survives: the card that had a style keeps exactly that style.
    expect(doc.getCard(styled.id)?.style).toEqual({ radius: 3 });
    expect(doc.getCard(card.id)?.style).toEqual({ shape: "pill" });
  });
});
