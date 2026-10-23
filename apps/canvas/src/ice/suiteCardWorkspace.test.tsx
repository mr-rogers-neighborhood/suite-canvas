import { cleanup, waitFor } from "@testing-library/react";
import { LoroList, LoroMap, LoroText } from "loro-crdt";
import { act } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CardMeta } from "../cards/cardMeta";
import type { PeerPresence } from "../collab/presence";
import { usePresenceStore } from "../collab/usePresenceStore";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import type { SuiteCardInfo } from "./suiteCardOverlay";
import {
  compactMetaChips,
  createWorkspaceCardSlotRenderer,
  editingChipsFor,
  editingPeersFor,
} from "./suiteCardWorkspace";

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

/** `band` lands on `SuiteCardInfo` separately; the fixture accepts it either way. */
type CardInfoFixture = Omit<SuiteCardInfo, "band"> & {
  band?: "full" | "compact" | "icon" | undefined;
};

function info(overrides: Partial<CardInfoFixture> = {}): SuiteCardInfo {
  return {
    entity: 1,
    title: "",
    body: "",
    cardId,
    boardId,
    worldWidth: 288,
    worldHeight: 240,
    ...overrides,
  } as SuiteCardInfo;
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

/** A peer with its caret in `focusNodeId`, on the card's board by default. */
function peer(
  clientId: string,
  name: string,
  focusNodeId: string | null = cardId,
  board: string | null = boardId,
): PeerPresence {
  return {
    clientId,
    board,
    user: { name, color: "#5b8def" },
    pointer: null,
    focus: focusNodeId === null ? null : { nodeId: focusNodeId, field: "body" },
    dragging: null,
    selection: null,
    selectionBox: null,
    connector: null,
    resizing: null,
    sectionDrag: null,
    sectionResize: null,
    reconnect: null,
    connect: null,
    labelDrag: null,
  };
}

/** Publish peers into the presence store the card's twin subscribes to. */
function setPeers(...peers: PeerPresence[]) {
  act(() => {
    usePresenceStore.setState({
      peers: Object.fromEntries(peers.map((entry) => [entry.clientId, entry])),
    });
  });
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
  usePresenceStore.setState({ peers: {} });
});

afterAll(() => {
  useUiStore.setState({
    readOnly: false,
    editingNodeId: null,
    editingSurface: "canvas",
    ...FULL_CAPABILITIES,
  });
  usePresenceStore.setState({ peers: {} });
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

describe("editingPeersFor", () => {
  it("should keep only peers whose caret is in the card", () => {
    const peers = [peer("a", "Ada"), peer("b", "Bob", "another-card"), peer("c", "Cy", null)];

    expect(editingPeersFor(cardId, peers).map((entry) => entry.user.name)).toEqual(["Ada"]);
  });

  it("should ignore a peer who only selected the card", () => {
    const selecting = peer("a", "Ada", null);
    selecting.selection = { nodeIds: [cardId] };

    expect(editingPeersFor(cardId, [selecting])).toEqual([]);
  });

  it("should order chips by name so repaints do not reshuffle them", () => {
    const peers = [peer("z", "Zoe"), peer("a", "Ada"), peer("m", "Moe")];

    expect(editingPeersFor(cardId, peers).map((entry) => entry.user.name)).toEqual([
      "Ada",
      "Moe",
      "Zoe",
    ]);
  });
});

describe("editingChipsFor", () => {
  it("should name every peer while the row has room", () => {
    const summary = editingChipsFor([peer("a", "Ada"), peer("b", "Bob")]);

    expect(summary.shown).toHaveLength(2);
    expect(summary.hidden).toBe(0);
  });

  it("should cap the names and count the remainder", () => {
    const summary = editingChipsFor([peer("a", "Ada"), peer("b", "Bob"), peer("c", "Cy")]);

    expect(summary.shown.map((entry) => entry.user.name)).toEqual(["Ada", "Bob"]);
    expect(summary.hidden).toBe(1);
  });
});

describe("the editing chip", () => {
  it("should render a chip per editing peer, with their colour dot", async () => {
    const { container, teardown } = mountCard();
    setPeers(peer("a", "Ada"));

    await waitFor(() =>
      expect(container.querySelectorAll('[data-testid="suite-card-editing-chip"]')).toHaveLength(1),
    );
    const chip = container.querySelector('[data-testid="suite-card-editing-chip"]');
    expect(chip).toHaveAttribute("data-peer-name", "Ada");
    expect(chip).toHaveTextContent("Ada");
    expect(chip?.firstElementChild).toHaveStyle({ backgroundColor: "#5b8def" });
    expect(container.querySelector('[data-testid="suite-card-editing-more"]')).toBeNull();

    act(() => teardown()?.());
    container.remove();
  });

  it("should render two named chips and no counter for two peers", async () => {
    const { container, teardown } = mountCard();
    setPeers(peer("a", "Ada"), peer("b", "Bob"));

    await waitFor(() =>
      expect(container.querySelectorAll('[data-testid="suite-card-editing-chip"]')).toHaveLength(2),
    );
    expect(container.querySelector('[data-testid="suite-card-editing-more"]')).toBeNull();

    act(() => teardown()?.());
    container.remove();
  });

  it("should collapse the third name into a +N chip", async () => {
    const { container, teardown } = mountCard();
    setPeers(peer("a", "Ada"), peer("b", "Bob"), peer("c", "Cy"), peer("d", "Dee"));

    await waitFor(() =>
      expect(container.querySelectorAll('[data-testid="suite-card-editing-chip"]')).toHaveLength(2),
    );
    expect(container.querySelector('[data-testid="suite-card-editing-more"]')).toHaveTextContent(
      "+2",
    );

    act(() => teardown()?.());
    container.remove();
  });

  it("should ignore peers focused elsewhere or on another board", async () => {
    const { container, teardown } = mountCard();
    setPeers(peer("a", "Ada", cardId, "another-board"), peer("b", "Bob", "another-card"));

    await waitFor(() =>
      expect(container.querySelector('[data-testid="node-card"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="suite-card-editing-chips"]')).toBeNull();

    act(() => teardown()?.());
    container.remove();
  });

  it("should render no chip when nobody is editing the card", async () => {
    const { container, teardown } = mountCard();

    await waitFor(() =>
      expect(container.querySelector('[data-testid="node-card"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="suite-card-editing-chips"]')).toBeNull();

    act(() => teardown()?.());
    container.remove();
  });

  it("should keep the twin read-only while a peer chip is shown", async () => {
    const { container, teardown } = mountCard();
    setPeers(peer("a", "Ada"));

    await waitFor(() =>
      expect(container.querySelector('[data-testid="suite-card-editing-chip"]')).not.toBeNull(),
    );
    expect(container.querySelector(".node-card-editor")).toHaveAttribute(
      "contenteditable",
      "false",
    );
    expect(container.querySelector('[data-testid="card-menu"]')).toBeNull();

    act(() => teardown()?.());
    container.remove();
  });
});

describe("compactMetaChips", () => {
  const meta: CardMeta = {
    properties: [
      { fieldId: "a", label: "Due", value: "Friday" },
      { fieldId: "b", label: "Owner", value: "Ada" },
    ],
    tags: ["reading", "deep"],
  };

  it("should show property values before tag names", () => {
    expect(compactMetaChips(meta)).toEqual([
      { key: "field:a", label: "Due: Friday" },
      { key: "field:b", label: "Owner: Ada" },
    ]);
  });

  it("should fall back to tags when the card has no properties", () => {
    expect(compactMetaChips({ properties: [], tags: ["reading", "deep"] })).toEqual([
      { key: "tag:reading", label: "#reading" },
      { key: "tag:deep", label: "#deep" },
    ]);
  });

  it("should cap the row at the requested count", () => {
    expect(compactMetaChips(meta, 1)).toEqual([{ key: "field:a", label: "Due: Friday" }]);
  });
});

describe("the compact band", () => {
  it("should paint a static face at the same box, with no editor", async () => {
    const commits: unknown[] = [];
    const unsubscribe = workspace.doc.subscribe((event) => commits.push(event));
    const { container, teardown } = mountCard({ band: "compact", title: "Compact title" });

    await waitFor(() =>
      expect(container.querySelector('[data-testid="suite-card-compact"]')).not.toBeNull(),
    );
    const face = container.querySelector<HTMLElement>('[data-testid="suite-card-compact"]');
    expect(face).toHaveStyle({ width: "288px", height: "240px", pointerEvents: "none" });
    // The static face carries the card tokens, not a second theme.
    expect(face?.getAttribute("style")).toContain("var(--surface)");
    expect(face?.getAttribute("style")).toContain("var(--hairline)");
    expect(container.querySelector('[data-testid="suite-card-title"]')).toHaveTextContent(
      "Compact title",
    );
    expect(container.querySelector('[data-testid="suite-card-glyph"]')?.textContent).toBeTruthy();

    // No product face, no editor, no text containers.
    expect(container.querySelector('[data-testid="node-card"]')).toBeNull();
    expect(container.querySelector('[data-testid="scene-card-view"]')).toBeNull();
    expect(container.querySelector('[data-testid="card-body"]')).toBeNull();
    expect(container.querySelector(".ProseMirror")).toBeNull();

    act(() => teardown()?.());
    unsubscribe();
    expect(commits).toEqual([]);
    container.remove();
  });

  it("should show up to two meta chips from the card's tags", async () => {
    const tag = workspace.createTag({ name: "compact-reading" });
    workspace.addCardTag(cardId, tag.id);
    const { container, teardown } = mountCard({ band: "compact", title: "Tagged" });

    await waitFor(() =>
      expect(container.querySelectorAll('[data-testid="suite-card-meta-chip"]')).toHaveLength(1),
    );
    expect(container.querySelector('[data-testid="suite-card-meta-chip"]')).toHaveTextContent(
      "#compact-reading",
    );

    act(() => teardown()?.());
    workspace.removeCardTag(cardId, tag.id);
    container.remove();
  });

  it("should keep the peer editing chip", async () => {
    const { container, teardown } = mountCard({ band: "compact" });
    setPeers(peer("a", "Ada"));

    await waitFor(() =>
      expect(container.querySelector('[data-testid="suite-card-editing-chip"]')).not.toBeNull(),
    );

    act(() => teardown()?.());
    container.remove();
  });
});

describe("the icon band", () => {
  it("should paint the type glyph alone, centred in the box", async () => {
    const commits: unknown[] = [];
    const unsubscribe = workspace.doc.subscribe((event) => commits.push(event));
    const { container, teardown } = mountCard({ band: "icon", title: "Ignored title" });

    await waitFor(() =>
      expect(container.querySelector('[data-testid="suite-card-icon"]')).not.toBeNull(),
    );
    const face = container.querySelector<HTMLElement>('[data-testid="suite-card-icon"]');
    expect(face).toHaveStyle({ width: "288px", height: "240px", pointerEvents: "none" });
    expect(face?.getAttribute("style")).toContain("var(--surface)");
    expect(face?.childElementCount).toBe(1);
    expect(container.querySelector('[data-testid="suite-card-glyph"]')?.textContent).toBeTruthy();
    expect(container.textContent).not.toContain("Ignored title");
    expect(container.querySelector('[data-testid="node-card"]')).toBeNull();
    expect(container.querySelector('[data-testid="scene-card-view"]')).toBeNull();

    act(() => teardown()?.());
    unsubscribe();
    expect(commits).toEqual([]);
    container.remove();
  });

  it("should not spend a chip on the icon box", async () => {
    const { container, teardown } = mountCard({ band: "icon" });
    setPeers(peer("a", "Ada"));

    await waitFor(() =>
      expect(container.querySelector('[data-testid="suite-card-icon"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="suite-card-editing-chips"]')).toBeNull();

    act(() => teardown()?.());
    container.remove();
  });
});
