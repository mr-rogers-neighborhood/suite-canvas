import type { WorkspaceDocument } from "@suite/graph";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { IceCardEditorLayer } from "./IceCardEditor";

/** ProseMirror reads client rects when a new selection scrolls into view. */
const rectTargets = [Node.prototype, Range.prototype] as unknown as Array<{
  getClientRects?: () => DOMRectList;
  getBoundingClientRect?: () => DOMRect;
}>;
for (const target of rectTargets) {
  target.getClientRects ??= () => [] as unknown as DOMRectList;
  target.getBoundingClientRect ??= () => new DOMRect();
}

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

describe("IceCardEditorLayer", () => {
  let workspace: WorkspaceDocument;
  let boardId = "";

  beforeEach(() => {
    workspace = useCanvasStore.getState().workspace;
    boardId = workspace.ensureView().id;
    useUiStore.setState({
      readOnly: false,
      editingNodeId: null,
      editingField: "body",
      editingSurface: "canvas",
      ...FULL_CAPABILITIES,
    });
  });

  afterEach(() => {
    cleanup();
  });

  function layer(
    cardId: string,
    overrides: Partial<Parameters<typeof IceCardEditorLayer>[0]> = {},
  ) {
    return render(
      <IceCardEditorLayer
        cardId={cardId}
        boardId={boardId}
        field="body"
        worldWidth={700}
        worldHeight={240}
        onFieldChange={vi.fn()}
        onClose={vi.fn()}
        onTextSettled={vi.fn()}
        {...overrides}
      />,
    );
  }

  const editableFields = (): Element[] => [
    ...document.querySelectorAll('.node-card [contenteditable="true"]'),
  ];

  it("gives the caret to the field it was opened on, and only that one", () => {
    const card = workspace.createCard({ typeId: "note", boardId, position: { x: 0, y: 0 } });
    layer(card.id, { field: "title" });
    expect(document.querySelectorAll(".node-card")).toHaveLength(1);
    expect(document.querySelector(".card-title-editor")).toHaveAttribute("contenteditable", "true");
    expect(document.querySelector(".node-card-editor")).toHaveAttribute("contenteditable", "false");

    cleanup();
    layer(card.id, { field: "body" });
    expect(document.querySelector(".card-title-editor")).toHaveAttribute(
      "contenteditable",
      "false",
    );
    expect(document.querySelector(".node-card-editor")).toHaveAttribute("contenteditable", "true");
    expect(editableFields()).toHaveLength(1);
  });

  it("asks the document for the text containers a bare card record lacks", () => {
    // A record that arrived without its rich text: `setCard` writes the card and
    // nothing else, so no container exists until a writer asks for one.
    const card = workspace.createCard({ typeId: "note", boardId, position: { x: 0, y: 0 } });
    const bare = { ...card, id: "bare-card-record" };
    workspace.setCard(bare);
    expect(workspace.cardContainers(bare.id).contentId).toBeNull();
    layer(bare.id);
    // Created once, through `WorkspaceDocument` — the same call the inspector
    // makes — and then the editor mounts over the sheet.
    expect(workspace.cardContainers(bare.id).titleId).not.toBeNull();
    expect(workspace.cardContainers(bare.id).contentId).not.toBeNull();
    expect(screen.getByTestId("node-card")).toBeInTheDocument();
  });

  it("publishes the caret presence while open and clears it on close", () => {
    const card = workspace.createCard({ typeId: "note", boardId, position: { x: 0, y: 0 } });
    const publishFocus = vi.fn();
    layer(card.id, { field: "title", publishFocus });
    expect(publishFocus).toHaveBeenCalledWith({ nodeId: card.id, field: "title" });

    act(() => {
      useUiStore.getState().stopEditing();
    });
    cleanup();
    expect(publishFocus).toHaveBeenLastCalledWith(null);
  });

  it("leaves the caret presence to the surface that took the card over", () => {
    const card = workspace.createCard({ typeId: "note", boardId, position: { x: 0, y: 0 } });
    const publishFocus = vi.fn();
    layer(card.id, { publishFocus });
    // The inspector opens the same card: the panel owns the caret now, so this
    // editor must not clear the focus the panel is about to publish.
    act(() => {
      useUiStore.getState().startEditing(card.id, "body", "panel");
    });
    cleanup();
    expect(publishFocus).not.toHaveBeenCalledWith(null);
  });

  it("renders nothing for a card the document does not hold", () => {
    layer("no-such-card");
    expect(screen.queryByTestId("node-card")).toBeNull();
  });
});
