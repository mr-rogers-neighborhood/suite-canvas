import { cleanup, waitFor } from "@testing-library/react";
import { LoroList, LoroMap, LoroText } from "loro-crdt";
import { act } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import type { SuiteCardInfo } from "./suiteCardOverlay";
import { createWorkspaceCardSlotRenderer } from "./suiteCardWorkspace";

// ProseMirror reads client rects when a selection scrolls into view; jsdom has
// no layout engine and no rect methods on text nodes or ranges.
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

function info(overrides: Partial<SuiteCardInfo> = {}): SuiteCardInfo {
  return {
    entity: 1,
    title: "",
    body: "",
    cardId,
    boardId,
    worldWidth: 288,
    worldHeight: 240,
    ...overrides,
  };
}

function mountCard(overrides: Partial<SuiteCardInfo> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const renderer = createWorkspaceCardSlotRenderer();
  let teardown: (() => void) | undefined;
  act(() => {
    teardown = renderer.mount(container, info(overrides));
  });
  return { container, teardown: () => teardown };
}

beforeAll(() => {
  useCanvasStore.setState({ ready: true, synced: true });
  const board = workspace.ensureBoard();
  boardId = board.id;
  cardId = workspace.createCard({ typeId: "note", boardId, position: { x: 0, y: 0 } }).id;
  writeTitle(cardId, "ICE card title");
  writeBody(cardId, "Body line for the ICE overlay.");
});

beforeEach(() => {
  useUiStore.setState({
    readOnly: false,
    editingNodeId: null,
    editingField: "body",
    editingSurface: "canvas",
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

describe("createWorkspaceCardSlotRenderer", () => {
  it("should mount the real card shell for the live workspace card", async () => {
    const { container, teardown } = mountCard();

    await waitFor(() => {
      const card = container.querySelector('[data-testid="node-card"]');
      expect(card).not.toBeNull();
      expect(card).toHaveAttribute("data-node-id", cardId);
      expect(card).toHaveAttribute("data-board-id", boardId);
    });
    await waitFor(() =>
      expect(container.querySelector('[data-testid="node-card"]')).toHaveTextContent(
        "ICE card title",
      ),
    );
    expect(container.querySelector('[data-testid="card-body"]')).toHaveTextContent(
      "Body line for the ICE overlay.",
    );
    // The slot is filled with the product face at the geometry's world size.
    expect(container.querySelector('[data-testid="scene-card-view"]')).toHaveStyle({
      width: "288px",
      height: "240px",
    });

    act(() => teardown()?.());
    expect(container.childElementCount).toBe(0);
    container.remove();
  });

  it("should mount read-only even in an editable session", async () => {
    const { container, teardown } = mountCard();

    await waitFor(() =>
      expect(container.querySelector('[data-testid="node-card"]')).not.toBeNull(),
    );
    expect(container.querySelector('[aria-label="Edit card title"]')).toBeNull();
    expect(container.querySelector('[data-testid="card-menu"]')).toBeNull();
    expect(container.querySelector(".node-card-editor")).toHaveAttribute(
      "contenteditable",
      "false",
    );

    act(() => teardown()?.());
    container.remove();
  });

  it("should render nothing for a card the workspace does not know", async () => {
    const commits: unknown[] = [];
    const unsubscribe = workspace.doc.subscribe((event) => commits.push(event));
    const { container, teardown } = mountCard({ cardId: "no-such-card" });

    // The root exists (the card may arrive with hydration) but paints nothing.
    await waitFor(() => expect(container.childElementCount).toBe(0));

    act(() => teardown()?.());
    unsubscribe();
    expect(commits).toEqual([]);
    expect(container.childElementCount).toBe(0);
    container.remove();
  });

  it("should mount no root at all when the object names no card", () => {
    const commits: unknown[] = [];
    const unsubscribe = workspace.doc.subscribe((event) => commits.push(event));
    const { container, teardown } = mountCard({ cardId: "", title: "Lab title" });

    expect(teardown()).toBeUndefined();
    expect(container.childElementCount).toBe(0);
    unsubscribe();
    expect(commits).toEqual([]);
    container.remove();
  });

  it("should not write to the document on mount or unmount", async () => {
    const commits: unknown[] = [];
    const unsubscribe = workspace.doc.subscribe((event) => commits.push(event));
    const { container, teardown } = mountCard();

    await waitFor(() =>
      expect(container.querySelector('[data-testid="node-card"]')).not.toBeNull(),
    );
    act(() => teardown()?.());
    unsubscribe();

    expect(commits).toEqual([]);
    container.remove();
  });
});
