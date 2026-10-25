import type { WorkspaceDocument } from "@suite/graph";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { Component, Entity, World } from "@vibecook/ice";
import { LoroList, LoroMap, LoroText } from "loro-crdt";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import type { IceShareCaps } from "./iceShareCaps";
import type { SeedReport } from "./iceSurfaceSpawns";
import type { Phase } from "./iceSurfaceStatus";
import type { IceCommands, IceSurfaceRefs, IceWiring } from "./iceSurfaceWiring";
import { SUITE_CARD_RUNGS, SUITE_CARD_TYPE } from "./suiteCardKind";
import { useIceCardEditing } from "./useIceCardEditing";

/** ProseMirror reads client rects when a new selection scrolls into view. */
const rectTargets = [Node.prototype, Range.prototype] as unknown as Array<{
  getClientRects?: () => DOMRectList;
  getBoundingClientRect?: () => DOMRect;
}>;
for (const target of rectTargets) {
  target.getClientRects ??= () => [] as unknown as DOMRectList;
  target.getBoundingClientRect ??= () => new DOMRect();
}

/** The base rung's face component: what `identityOf` reads a card id from. */
const CARD_FACE = SUITE_CARD_RUNGS[0]?.face as Component<unknown>;
const Camera = { name: "Camera" };
const Position = { name: "Position" };
const Size = { name: "Size" };
const VIEW = { w: 1440, h: 900 };
const CAMERA = { x: 0, y: 0, zoom: 1, gesturing: false };
const CARD_BOX = { x: 100, y: 120, w: 700, h: 240 };

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

function caps(canEditContent: boolean): IceShareCaps {
  return {
    role: canEditContent ? "owner" : "viewer",
    controllerRole: canEditContent ? "owner" : "viewer",
    canWriteLayout: canEditContent,
    canEditContent,
  } as unknown as IceShareCaps;
}

describe("the canvas card editor", () => {
  let doc: WorkspaceDocument;
  let boardId = "";
  let noteId = "";
  let otherNoteId = "";
  let whiteboardId = "";
  /** Entities the fake world holds: an entity per card, all on the same board. */
  const entities = new Map<Entity, string>();
  let nextEntity = 1;

  function entityFor(cardId: string): Entity {
    for (const [entity, id] of entities) if (id === cardId) return entity;
    const entity = nextEntity++ as Entity;
    entities.set(entity, cardId);
    return entity;
  }

  function world(): World {
    const fake = {
      isAlive: (entity: Entity) => entities.has(entity),
      has: (entity: Entity, component: Component<unknown>) =>
        entities.has(entity) &&
        (component === CARD_FACE || component === Position || component === Size),
      read: (entity: Entity, component: Component<unknown>) => {
        const cardId = entities.get(entity);
        if (cardId === undefined) return undefined;
        if ((component as { name?: string }).name === "PrefabId") return { id: SUITE_CARD_TYPE };
        if (component === CARD_FACE) return { cardId, boardId };
        if (component === Position) return { x: CARD_BOX.x, y: CARD_BOX.y };
        if (component === Size) return { w: CARD_BOX.w, h: CARD_BOX.h };
        return undefined;
      },
      getResource: (resource: unknown) => {
        if (resource === Camera) return CAMERA;
        if ((resource as { name?: string }).name === "Viewport") return VIEW;
        return undefined;
      },
      getRelation: () => undefined,
    };
    return fake as unknown as World;
  }

  function writeTitle(cardId: string, text: string): void {
    const title = doc.getTitle(cardId);
    title.set("nodeName", "doc");
    const blocks = title.getOrCreateContainer("children", new LoroList());
    const paragraph = blocks.insertContainer(0, new LoroMap());
    paragraph.set("nodeName", "paragraph");
    paragraph.getOrCreateContainer("attributes", new LoroMap());
    const inline = paragraph.getOrCreateContainer("children", new LoroList());
    inline.insertContainer(0, new LoroText()).insert(0, text);
    doc.doc.commit({ origin: "text:title" });
  }

  function writeBody(cardId: string, text: string): void {
    const content = doc.getContent(cardId);
    content.set("nodeName", "doc");
    const blocks = content.getOrCreateContainer("children", new LoroList());
    const paragraph = blocks.insertContainer(blocks.length, new LoroMap());
    paragraph.set("nodeName", "paragraph");
    paragraph.getOrCreateContainer("attributes", new LoroMap());
    const inline = paragraph.getOrCreateContainer("children", new LoroList());
    inline.insertContainer(0, new LoroText()).insert(0, text);
    doc.doc.commit({ origin: "text:body" });
  }

  /** One keystroke's worth of document write, in the origin the editor uses. */
  function type(text: string): void {
    writeBody(noteId, text);
  }

  function wiringFor(
    options: { readonly canEditContent?: boolean; readonly framePath?: readonly string[] } = {},
  ): IceWiring {
    const phase = {
      kind: "ready",
      engine: { world: world() },
      core: { Camera, Position, Size },
      Desk: () => null,
      EngineProvider: ({ children }: { children: unknown }) => children,
      layer: () => () => ({}),
      objects: {},
      adapter: { kind: "hardware" },
    } as unknown as Phase;
    const seed = {
      mode: "live",
      label: "Live workspace",
      seeded: entities.size,
      total: entities.size,
      kinds: [SUITE_CARD_TYPE],
      failures: [],
      entities: [...entities.keys()],
      entitySlots: new Map(
        [...entities].map(([entity, cardId]) => [
          entity,
          { cardId, boardId, text: doc.displayTitle(cardId) },
        ]),
      ),
      boardMats: new Map(),
      stubs: 0,
      pinEntities: new Map(),
      boards: 1,
      skipped: [],
    } as unknown as SeedReport;
    return {
      phase,
      seed,
      layerReady: 1,
      workspaceMode: true,
      liveWorkspace: doc,
      rootBoardId: boardId,
      caps: caps(options.canEditContent ?? true),
      cameraApi: null,
      flyTo: () => undefined,
    };
  }

  function refsFor(root: HTMLElement): IceSurfaceRefs {
    return {
      surface: { current: root },
      desk: {
        current: {
          pick: (point: { x: number; y: number }) => {
            // The card's box, in container px, is the only pickable thing here.
            const inside =
              point.x >= CARD_BOX.x &&
              point.x <= CARD_BOX.x + CARD_BOX.w &&
              point.y >= CARD_BOX.y &&
              point.y <= CARD_BOX.y + CARD_BOX.h;
            return inside ? { entity: entityFor(noteId), type: SUITE_CARD_TYPE } : undefined;
          },
          geometryOf: (entity: Entity) =>
            entities.has(entity)
              ? {
                  centre: [CARD_BOX.x + CARD_BOX.w / 2, CARD_BOX.y + CARD_BOX.h / 2],
                  half: [CARD_BOX.w / 2, CARD_BOX.h / 2],
                  angle: 0,
                }
              : undefined,
        },
      } as unknown as IceSurfaceRefs["desk"],
      overlays: { current: document.createElement("div") },
    };
  }

  function mount(options: { canEditContent?: boolean; framePath?: readonly string[] } = {}) {
    const root = document.createElement("div");
    root.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: VIEW.w,
        bottom: VIEW.h,
        width: VIEW.w,
        height: VIEW.h,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.append(root);
    const reconcile = vi.fn();
    const closeWhiteboard = vi.fn();
    const commands: { current: IceCommands | null } = { current: null };
    const wiring = wiringFor(options);
    const refs = refsFor(root);
    const api: { current: ReturnType<typeof useIceCardEditing> | null } = { current: null };

    function Host({ framePath }: { framePath?: readonly string[] | undefined }) {
      commands.current = {
        undo: vi.fn(),
        redo: vi.fn(),
        deleteSelection: vi.fn(),
        copy: vi.fn(),
        cut: vi.fn(),
        paste: vi.fn(),
        duplicate: vi.fn(),
        nudge: vi.fn(),
        reconcile,
        escape: vi.fn(),
        zoomBy: vi.fn(),
        fitView: vi.fn(),
      };
      const editing = useIceCardEditing({
        wiring,
        refs,
        commands,
        framePath,
        closeWhiteboard,
      });
      api.current = editing;
      return <div data-testid="host">{editing.editor}</div>;
    }

    const view = render(<Host framePath={options.framePath} />, { container: document.body });
    return {
      api,
      commands,
      reconcile,
      closeWhiteboard,
      root,
      rerender: (framePath: readonly string[]) => view.rerender(<Host framePath={framePath} />),
      unmount: view.unmount,
    };
  }

  beforeAll(() => {
    doc = useCanvasStore.getState().workspace;
    boardId = doc.ensureView().id;
    noteId = doc.createCard({ typeId: "note", boardId, position: { x: 120, y: 120 } }).id;
    writeTitle(noteId, "A note you can write in");
    writeBody(noteId, "First line.");
    otherNoteId = doc.createCard({ typeId: "note", boardId, position: { x: 900, y: 120 } }).id;
    writeTitle(otherNoteId, "Another note");
    writeBody(otherNoteId, "Second card.");
    whiteboardId = doc.createCard({ typeId: "whiteboard", boardId, position: { x: 0, y: 0 } }).id;
    writeTitle(whiteboardId, "A drawing");
    entityFor(noteId);
    entityFor(otherNoteId);
    entityFor(whiteboardId);
  });

  beforeEach(() => {
    useUiStore.setState({
      readOnly: false,
      editingNodeId: null,
      editingField: "body",
      editingSurface: "canvas",
      selectedNodeIds: [],
      cardFocusId: null,
      ...FULL_CAPABILITIES,
    });
  });

  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
  });

  afterAll(() => {
    useUiStore.setState({
      readOnly: false,
      editingNodeId: null,
      editingSurface: "canvas",
      ...FULL_CAPABILITIES,
    });
  });

  it("opens one editor on a double-clicked card, and only one", () => {
    const host = mount();
    act(() => {
      host.root.dispatchEvent(
        new MouseEvent("dblclick", {
          clientX: CARD_BOX.x + 10,
          clientY: CARD_BOX.y + 10,
          bubbles: true,
        }),
      );
    });
    expect(screen.getAllByTestId("ice-card-editor")).toHaveLength(1);
    expect(screen.getByTestId("ice-card-editor")).toHaveAttribute("data-card-id", noteId);
    // One card face, and exactly one field accepting text in it.
    expect(screen.getAllByTestId("node-card")).toHaveLength(1);
    const editables = document.querySelectorAll('.ice-card-editor [contenteditable="true"]');
    expect(editables).toHaveLength(1);
    expect(useUiStore.getState().editingNodeId).toBe(noteId);
    expect(useUiStore.getState().editingSurface).toBe("canvas");
  });

  it("opens the one selected card on Enter", () => {
    const host = mount();
    act(() => {
      useUiStore.setState({ selectedNodeIds: [otherNoteId] });
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    });
    expect(screen.getByTestId("ice-card-editor")).toHaveAttribute("data-card-id", otherNoteId);
    void host;
  });

  it("opens the card the shell just created, even below the readable gate", () => {
    // A new card is 288 world units wide; at this zoom that is 60 px, far under
    // the gesture gate, and its title is still exactly what the reader asked for.
    const previous = CAMERA.zoom;
    CAMERA.zoom = 0.1;
    try {
      const host = mount();
      act(() => {
        useUiStore.getState().startEditing(otherNoteId, "title", "canvas");
      });
      expect(screen.getByTestId("ice-card-editor")).toHaveAttribute("data-card-id", otherNoteId);
      expect(screen.getByTestId("ice-card-editor")).toHaveAttribute("data-field", "title");
      act(() => {
        useUiStore.getState().stopEditing();
      });
      // The same card through a *gesture* is refused: the reader cannot read it.
      act(() => {
        host.api.current?.open(otherNoteId);
      });
      expect(screen.queryByTestId("ice-card-editor")).toBeNull();
    } finally {
      CAMERA.zoom = previous;
    }
  });

  it("opens nothing for a viewer", () => {
    const host = mount({ canEditContent: false });
    act(() => {
      host.api.current?.open(noteId);
      host.root.dispatchEvent(
        new MouseEvent("dblclick", {
          clientX: CARD_BOX.x + 10,
          clientY: CARD_BOX.y + 10,
          bubbles: true,
        }),
      );
      useUiStore.setState({ selectedNodeIds: [noteId] });
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    });
    expect(screen.queryByTestId("ice-card-editor")).toBeNull();
    expect(useUiStore.getState().editingNodeId).toBeNull();
  });

  it("never opens a text editor on a whiteboard, and closes the stage when a note opens", () => {
    const host = mount();
    act(() => {
      host.api.current?.open(whiteboardId);
    });
    expect(screen.queryByTestId("ice-card-editor")).toBeNull();

    act(() => {
      host.api.current?.open(noteId);
    });
    expect(screen.getByTestId("ice-card-editor")).toHaveAttribute("data-card-id", noteId);
    // The desk's other DOM editor (the drawing stage) is shut by the same open.
    expect(host.closeWhiteboard).toHaveBeenCalled();
  });

  it("moves the editor to a second card instead of mounting another", () => {
    const host = mount();
    act(() => {
      host.api.current?.open(noteId);
    });
    expect(screen.getByTestId("ice-card-editor")).toHaveAttribute("data-card-id", noteId);
    act(() => {
      host.api.current?.open(otherNoteId);
    });
    expect(screen.getAllByTestId("ice-card-editor")).toHaveLength(1);
    expect(screen.getByTestId("ice-card-editor")).toHaveAttribute("data-card-id", otherNoteId);
    expect(document.querySelector(`[data-node-id="${noteId}"]`)).toBeNull();
  });

  it("settles typing into one canvas commit per window and flushes the last on close", () => {
    vi.useFakeTimers();
    try {
      const host = mount();
      act(() => {
        host.api.current?.open(noteId);
      });
      act(() => {
        type("one");
        type("two");
        type("three");
      });
      expect(host.reconcile).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(host.reconcile).toHaveBeenCalledTimes(1);

      act(() => {
        type(" four");
      });
      act(() => {
        host.api.current?.close();
      });
      expect(host.reconcile).toHaveBeenCalledTimes(2);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(host.reconcile).toHaveBeenCalledTimes(2);
      expect(useUiStore.getState().editingNodeId).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes on Escape without a further commit, after the flush", () => {
    const host = mount();
    act(() => {
      host.api.current?.open(noteId);
    });
    const editor = screen.getByTestId("ice-card-editor");
    act(() => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(useUiStore.getState().editingNodeId).toBeNull();
    expect(screen.queryByTestId("ice-card-editor")).toBeNull();
    const after = host.reconcile.mock.calls.length;
    act(() => {
      type("late");
    });
    expect(host.reconcile.mock.calls.length).toBe(after);
  });

  it("closes when the selection leaves the card", () => {
    const host = mount();
    act(() => {
      host.api.current?.open(noteId);
    });
    act(() => {
      useUiStore.setState({ selectedNodeIds: [otherNoteId] });
    });
    expect(screen.queryByTestId("ice-card-editor")).toBeNull();
    expect(useUiStore.getState().editingNodeId).toBeNull();
    void host;
  });

  it("closes when the card leaves the document", () => {
    const host = mount();
    act(() => {
      host.api.current?.open(noteId);
    });
    act(() => {
      doc.trashCard(noteId);
    });
    expect(screen.queryByTestId("ice-card-editor")).toBeNull();
    act(() => {
      doc.restoreCard(noteId);
    });
    void host;
  });

  it("closes when a Board is entered", () => {
    const host = mount();
    act(() => {
      host.api.current?.open(noteId);
    });
    act(() => {
      host.rerender(["Inner board"]);
    });
    expect(screen.queryByTestId("ice-card-editor")).toBeNull();
  });

  it("clears the editing state when the desk tears down", () => {
    const host = mount();
    act(() => {
      host.api.current?.open(noteId);
    });
    act(() => {
      host.unmount();
    });
    expect(useUiStore.getState().editingNodeId).toBeNull();
  });
});
