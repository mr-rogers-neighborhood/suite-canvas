import type { Card, CardType } from "@suite/graph";
import { WorkspaceDocument } from "@suite/graph";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { beforeEach, describe, expect, it } from "vitest";
import { promoteAnnotation } from "../reader/promote";
import { useCanvasStore } from "../store/useCanvasStore";
import { NodeCard } from "./NodeCard";

/**
 * A card that holds a passage, and how tall it is.
 *
 * The box used to be `height ?? DEFAULT_CARD_HEIGHT` for every card, which is why the quotation was clamped to two lines
 * to fit 240px. A passage is usually one sentence, so this card's height comes from its content until the reader
 * resizes it — and a resize is a decision, so a stored height wins from then on.
 */
let workspace: WorkspaceDocument;
let card: Card;
let type: CardType;
let contentId: NonNullable<ReturnType<WorkspaceDocument["peekContent"]>>["id"];
let titleId: NonNullable<ReturnType<WorkspaceDocument["peekTitle"]>>["id"];

beforeEach(() => {
  workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const book = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  workspace.setTitleText(book.id, "A Small Book");
  workspace.ensureAnnotationStyles();
  const annotation = workspace.addAnnotation({
    sourceCardId: book.id,
    styleId: "style-yellow",
    anchor: {
      kind: "quote",
      locator: "OEBPS/text/chapter1.xhtml",
      quote: "One short sentence.",
      prefix: "",
      suffix: "",
    },
    excerpt: "One short sentence.",
  });
  const promoted = promoteAnnotation({ workspace, annotation, placement: { inbox: true } });
  const made = workspace.getCard(promoted.cardId);
  if (made === undefined) throw new Error("no card");
  card = made;
  const primary = workspace.getType(card.primaryTypeId);
  if (primary === undefined) throw new Error("no type");
  type = primary;
  const content = workspace.peekContent(card.id);
  const title = workspace.peekTitle(card.id);
  if (content === null || title === null) throw new Error("no containers");
  contentId = content.id;
  titleId = title.id;
  useCanvasStore.setState({ workspace });
});

function draw(overrides: { height?: number | null } = {}) {
  const { container } = render(
    <ReactFlowProvider>
      <NodeCard
        card={card}
        type={type}
        meta={{ properties: [], tags: [] }}
        cardDoc={workspace.doc}
        contentId={contentId}
        titleId={titleId}
        cursorStore={null}
        localUser={null}
        boardId="board-1"
        {...overrides}
      />
    </ReactFlowProvider>,
  );
  return container;
}

/** The box the card actually occupies, which is what a board lays out against. */
function box(container: HTMLElement): HTMLElement {
  const found = container.querySelector<HTMLElement>(".node-card");
  if (found === null) throw new Error("no card box");
  return found;
}

describe("a card that holds a passage", () => {
  it("should take its height from the passage when nobody has resized it", () => {
    const container = draw();
    // `auto`, not a number: the passage decides, and the board measures what it decided.
    expect(box(container).style.height).toBe("auto");
    expect(box(container).style.minHeight).not.toBe("");
  });

  it("should keep the height the reader chose", () => {
    const container = draw({ height: 320 });
    expect(box(container).style.height).toBe("320px");
    expect(box(container).style.minHeight).toBe("");
  });

  it("should not reserve the rest of the card for an empty body", () => {
    const container = draw();
    // Nothing written under the passage: the body's scroll area must not claim the space the card no longer has.
    expect(screen.getByTestId("card-body").className).toContain("flex-none");
    expect(box(container).style.height).toBe("auto");
  });

  it("should grow for the writing once there is some", () => {
    workspace.setBodyText(card.id, "A comment on the passage.");
    draw();
    expect(screen.getByTestId("card-body").className).toContain("flex-1");
  });

  it("should leave an ordinary card at the shared default height", () => {
    const plain = workspace.createCard({ boardId: workspace.listBoards()[0]?.id ?? "" });
    const type = workspace.getType(plain.primaryTypeId);
    if (type === undefined) throw new Error("no type");
    const { container } = render(
      <ReactFlowProvider>
        <NodeCard
          card={plain}
          type={type}
          meta={{ properties: [], tags: [] }}
          cardDoc={workspace.doc}
          contentId={workspace.peekContent(plain.id)?.id}
          titleId={workspace.peekTitle(plain.id)?.id}
          cursorStore={null}
          localUser={null}
          boardId="board-1"
        />
      </ReactFlowProvider>,
    );
    // Every other card keeps the box the canvas, the section fit and the drop offset all assume.
    expect(box(container).style.height).toBe("240px");
  });
});
