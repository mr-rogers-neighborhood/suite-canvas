import { type Card, WorkspaceDocument } from "@suite/graph";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LoroList, LoroMap, LoroText } from "loro-crdt";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FALLBACK_CARD_TYPE } from "../cards/cardTypes";
import { WHITEBOARD_TYPE_ID } from "../cards/whiteboard";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { CardSurface } from "./CardSurface";

// ProseMirror reads client rects when a new selection scrolls into view. jsdom
// has no layout engine, and neither a text node nor a Range has rect methods, so
// an editor that gains focus would throw instead of taking the caret.
const rectTargets = [Node.prototype, Range.prototype] as unknown as Array<{
  getClientRects?: () => DOMRectList;
  getBoundingClientRect?: () => DOMRect;
}>;
for (const target of rectTargets) {
  target.getClientRects ??= () => [] as unknown as DOMRectList;
  target.getBoundingClientRect ??= () => new DOMRect();
}

const workspace = useCanvasStore.getState().workspace;

const FULL_CAPABILITIES = {
  canEditContent: true,
  canEditLayout: true,
  canPublish: false,
  canCreateContent: true,
  canCreateBoards: true,
  canManageBoards: true,
  canManageSchema: true,
  canManageTrash: true,
  canManageLinks: true,
} as const;

const NO_CAPABILITIES = {
  canEditContent: false,
  canEditLayout: false,
  canPublish: false,
  canCreateContent: false,
  canCreateBoards: false,
  canManageBoards: false,
  canManageSchema: false,
  canManageTrash: false,
  canManageLinks: false,
} as const;

const EMPTY_META = { properties: [], tags: [] };

let boardId = "";
let cardId = "";

/** A title tree in the shape `loro-prosemirror` writes. */
function writeTitle(targetId: string, text: string) {
  const title = workspace.getTitle(targetId);
  title.set("nodeName", "doc");
  const blocks = title.getOrCreateContainer("children", new LoroList());
  const paragraph = blocks.insertContainer(0, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.getOrCreateContainer("attributes", new LoroMap());
  const inline = paragraph.getOrCreateContainer("children", new LoroList());
  inline.insertContainer(0, new LoroText()).insert(0, text);
  workspace.doc.commit({ origin: "text:title" });
}

/** A body paragraph, written straight into the card's content container. */
function writeBody(targetId: string, text: string) {
  const content = workspace.getContent(targetId);
  content.set("nodeName", "doc");
  const blocks = content.getOrCreateContainer("children", new LoroList());
  const paragraph = blocks.insertContainer(blocks.length, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.getOrCreateContainer("attributes", new LoroMap());
  const inline = paragraph.getOrCreateContainer("children", new LoroList());
  inline.insertContainer(0, new LoroText()).insert(0, text);
  workspace.doc.commit({ origin: "text:body" });
}

function currentCard(): Card {
  const card = workspace.getCard(cardId);
  if (!card) throw new Error("fixture card missing");
  return card;
}

function bodyEditor(container: HTMLElement): HTMLElement {
  const element = container.querySelector(".node-card-editor");
  if (!element) throw new Error("body editor not mounted");
  return element as HTMLElement;
}

function renderView(overrides: Partial<Parameters<typeof CardSurface>[0]> = {}) {
  return render(
    <CardSurface
      card={currentCard()}
      type={FALLBACK_CARD_TYPE}
      meta={EMPTY_META}
      boardId={boardId}
      {...overrides}
    />,
  );
}

beforeAll(() => {
  useCanvasStore.setState({ ready: true, synced: true });
  const board = workspace.ensureView();
  boardId = board.id;
  cardId = workspace.createCard({ typeId: "note", boardId, position: { x: 0, y: 0 } }).id;
  writeTitle(cardId, "Scene card title");
  writeBody(cardId, "Body line for the scene.");
});

beforeEach(() => {
  useUiStore.setState({
    readOnly: false,
    editingNodeId: null,
    editingField: "body",
    editingSurface: "canvas",
    cardFocusId: null,
    ...FULL_CAPABILITIES,
  });
});

afterAll(() => {
  useUiStore.setState({
    readOnly: false,
    editingNodeId: null,
    editingSurface: "canvas",
    ...FULL_CAPABILITIES,
  });
  cleanup();
});

describe("CardSurface", () => {
  it("should render the live card face for a workspace card", async () => {
    renderView({ width: 320, height: 260 });

    const view = screen.getByTestId("card-surface");
    expect(view).toHaveAttribute("data-card-id", cardId);
    expect(view).toHaveStyle({ width: "320px", height: "260px" });

    const card = screen.getByTestId("node-card");
    expect(card).toHaveAttribute("data-node-id", cardId);
    expect(card).toHaveAttribute("data-board-id", boardId);
    // The editors bind to the Loro containers on the next tick, not on render.
    await waitFor(() => expect(card).toHaveTextContent("Scene card title"));
    expect(screen.getByTestId("card-body")).toHaveTextContent("Body line for the scene.");
  });

  it("should offer the edit affordance while the body is not editable", () => {
    const { container } = renderView();

    expect(screen.getByLabelText("Edit card title")).toBeInTheDocument();
    expect(screen.getByTestId("card-body")).toBeInTheDocument();
    expect(bodyEditor(container)).toHaveAttribute("contenteditable", "false");
  });

  it("should start canvas editing when the body is double-clicked", async () => {
    const { container } = renderView();

    fireEvent.doubleClick(screen.getByTestId("card-body"));

    await waitFor(() =>
      expect(useUiStore.getState()).toMatchObject({
        editingNodeId: cardId,
        editingSurface: "canvas",
        editingField: "body",
      }),
    );
    await waitFor(() => expect(bodyEditor(container)).toHaveAttribute("contenteditable", "true"));
  });

  it("should leave the body read-only while the panel owns editing", () => {
    useUiStore.setState({ editingNodeId: cardId, editingSurface: "panel", editingField: "body" });
    const { container } = renderView();

    expect(bodyEditor(container)).toHaveAttribute("contenteditable", "false");
  });

  it("should hide editing and the card menu for a viewer", () => {
    useUiStore.setState({ readOnly: true, ...NO_CAPABILITIES });
    const { container } = renderView();

    expect(screen.queryByLabelText("Edit card title")).not.toBeInTheDocument();
    expect(screen.queryByTestId("card-menu")).not.toBeInTheDocument();
    expect(bodyEditor(container)).toHaveAttribute("contenteditable", "false");
  });

  it("should go read-only when the caller overrides it in an editable session", () => {
    // The session itself may edit; the ICE overlay's twin must not. Both gates
    // are on, so only the prop can be doing the work.
    const { container } = renderView({ readOnly: true });

    expect(screen.queryByLabelText("Edit card title")).not.toBeInTheDocument();
    expect(screen.queryByTestId("card-menu")).not.toBeInTheDocument();
    expect(bodyEditor(container)).toHaveAttribute("contenteditable", "false");
  });

  it("should keep editing when the override is off", () => {
    const { container } = renderView({ readOnly: false });

    expect(screen.getByLabelText("Edit card title")).toBeInTheDocument();
    expect(screen.getByTestId("card-menu")).toBeInTheDocument();
    expect(bodyEditor(container)).toHaveAttribute("contenteditable", "false");
  });

  it("should not write to the document on mount", () => {
    // A card with no text containers yet is the risky case: mounting must not
    // create them, because a full-LOD instance can appear without a gesture.
    const bareId = workspace.createCard({
      typeId: "note",
      boardId,
      position: { x: 0, y: 600 },
    }).id;
    workspace.doc.getMap(WorkspaceDocument.CONTENT_KEY).delete(bareId);
    workspace.doc.getMap(WorkspaceDocument.TITLES_KEY).delete(bareId);
    workspace.doc.commit({ origin: "test" });
    const bare = workspace.getCard(bareId);
    if (!bare) throw new Error("bare fixture missing");

    const commits: unknown[] = [];
    const unsubscribe = workspace.doc.subscribe((event) => {
      commits.push(event);
    });

    try {
      renderView();
      render(
        <CardSurface card={bare} type={FALLBACK_CARD_TYPE} meta={EMPTY_META} boardId={boardId} />,
      );
    } finally {
      unsubscribe();
    }

    expect(commits).toEqual([]);
    expect(workspace.peekContent(bareId)).toBeNull();
    expect(workspace.peekTitle(bareId)).toBeNull();
    expect(workspace.peekContent(cardId)).not.toBeNull();
    expect(workspace.peekTitle(cardId)).not.toBeNull();
  });

  it("should render a whiteboard as a preview that opens the focus surface", async () => {
    const whiteboardId = workspace.createCard({
      typeId: WHITEBOARD_TYPE_ID,
      boardId,
      position: { x: 400, y: 0 },
    }).id;
    const card = workspace.getCard(whiteboardId);
    if (!card) throw new Error("whiteboard fixture missing");

    render(
      <CardSurface card={card} type={FALLBACK_CARD_TYPE} meta={EMPTY_META} boardId={boardId} />,
    );

    // A drawing has no rich-text body, so no Tiptap editor is mounted for it.
    expect(screen.queryByTestId("node-card")).not.toBeInTheDocument();
    const face = screen.getByTestId("card-surface-whiteboard");
    expect(within(face).getByTestId("whiteboard-preview")).toBeInTheDocument();

    fireEvent.doubleClick(face);

    await waitFor(() => expect(useUiStore.getState().cardFocusId).toBe(whiteboardId));
  });

  it("should show a placeholder until a card's text containers arrive", () => {
    const pendingId = workspace.createCard({
      typeId: "note",
      boardId,
      position: { x: 0, y: 400 },
    }).id;
    workspace.doc.getMap(WorkspaceDocument.CONTENT_KEY).delete(pendingId);
    workspace.doc.commit({ origin: "test" });

    const card = workspace.getCard(pendingId);
    if (!card) throw new Error("pending fixture missing");

    render(
      <CardSurface card={card} type={FALLBACK_CARD_TYPE} meta={EMPTY_META} boardId={boardId} />,
    );

    expect(screen.getByTestId("card-surface-placeholder")).toHaveTextContent("Untitled");
    expect(screen.queryByTestId("node-card")).not.toBeInTheDocument();
  });

  it("should render the card at its natural size when the layer passes no box", () => {
    renderView();

    expect(screen.getByTestId("node-card")).toHaveStyle({ width: "288px", height: "240px" });
  });
});
