import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeCardEditor,
  attachCardEditorOpeners,
  cardEditorBox,
  createTextCommitBarrier,
  ICE_CARD_EDITOR_COMMIT_MS,
  type IceCardEditorDecision,
  type IceCardEditorOpeners,
  isTypingTarget,
  mayOfferCardEditor,
  planCardEditor,
  SUITE_CARD_EDITOR_MIN_SCREEN_WIDTH,
} from "./iceCardEditor";

const OWNER = null;
const CARD = { cardId: "card-1", boardId: "board-1" };

function plan(
  overrides: Partial<Parameters<typeof planCardEditor>[0]> = {},
): IceCardEditorDecision {
  return planCardEditor({
    cardId: "card-1",
    boardId: "board-1",
    card: { deletedAt: null },
    whiteboard: false,
    title: "A note",
    canEditContent: true,
    share: OWNER,
    screenWidth: 600,
    ...overrides,
  });
}

describe("cardEditorBox", () => {
  it("maps ICE's geometry and camera to the editor's screen box", () => {
    expect(
      cardEditorBox({
        geometry: { centre: [300, 150], half: [144, 120], angle: Math.PI / 2 },
        camera: { x: 100, y: 50, zoom: 2 },
      }),
    ).toEqual({
      left: 112,
      top: -40,
      width: 576,
      height: 480,
      worldWidth: 288,
      worldHeight: 240,
      scale: 2,
      angleDeg: 90,
    });
  });

  it("falls back to the canonical rect when the paper is gone for a tick", () => {
    expect(
      cardEditorBox({ rect: { x: 40, y: 60, w: 288, h: 240 }, camera: { x: 10, y: 20, zoom: 2 } }),
    ).toMatchObject({ left: 60, top: 80, width: 576, height: 480, scale: 2, angleDeg: 0 });
  });

  it("answers nothing when the camera or the box is unusable", () => {
    expect(
      cardEditorBox({ geometry: null, rect: null, camera: { x: 0, y: 0, zoom: 1 } }),
    ).toBeNull();
    expect(
      cardEditorBox({
        geometry: { centre: [0, 0], half: [10, 10], angle: 0 },
        camera: { x: 0, y: 0, zoom: 0 },
      }),
    ).toBeNull();
  });
});

describe("the editor's size gate", () => {
  it("is offered from 320 CSS px of card width, whatever rung it settled on", () => {
    expect(SUITE_CARD_EDITOR_MIN_SCREEN_WIDTH).toBe(320);
    const box = { width: SUITE_CARD_EDITOR_MIN_SCREEN_WIDTH } as const;
    expect(mayOfferCardEditor({ ...box, left: 0, top: 0, height: 120 } as never)).toBe(true);
  });

  it("is refused below it, where the sheet reads but the editor would not", () => {
    const box = {
      left: 0,
      top: 0,
      width: SUITE_CARD_EDITOR_MIN_SCREEN_WIDTH - 1,
      height: 120,
      worldWidth: 700,
      worldHeight: 240,
      scale: 0.4,
      angleDeg: 0,
    };
    expect(mayOfferCardEditor(box)).toBe(false);
    expect(mayOfferCardEditor(null)).toBe(false);
  });
});

describe("planCardEditor", () => {
  it("opens the body of a titled card and the title of an untitled one", () => {
    expect(plan()).toEqual({ ok: true, field: "body" });
    expect(plan({ title: "   " })).toEqual({ ok: true, field: "title" });
    expect(plan({ field: "title" })).toEqual({ ok: true, field: "title" });
  });

  it("refuses a viewer, a seat without content authority", () => {
    expect(plan({ canEditContent: false })).toEqual({ ok: false, reason: "read-only" });
  });

  it("refuses a card the document does not hold, or holds in the trash", () => {
    expect(plan({ card: undefined })).toEqual({ ok: false, reason: "missing-card" });
    expect(plan({ card: { deletedAt: 1 } })).toEqual({ ok: false, reason: "trashed" });
  });

  it("refuses a card outside the share's scope", () => {
    const share = {
      scope: "board" as const,
      role: "editor" as const,
      boardId: "board-2",
    };
    expect(plan({ share })).toEqual({ ok: false, reason: "out-of-scope" });
    // The same share accepts its own board: the refusal is the scope, not the role.
    expect(plan({ share, boardId: "board-2" })).toEqual({ ok: true, field: "body" });
  });

  it("refuses a whiteboard, which opens its drawing stage instead", () => {
    expect(plan({ whiteboard: true })).toEqual({ ok: false, reason: "whiteboard" });
  });

  it("skips the readable gate when the caller cannot measure the card", () => {
    // A card the projection has not spawned yet, or one the shell named: an
    // explicit request is not a gesture on something the reader can see.
    expect(plan({ screenWidth: undefined })).toEqual({ ok: true, field: "body" });
  });

  it("refuses a card too small to read", () => {
    expect(plan({ screenWidth: SUITE_CARD_EDITOR_MIN_SCREEN_WIDTH - 1 })).toEqual({
      ok: false,
      reason: "too-small",
    });
    expect(plan({ screenWidth: 0 })).toEqual({ ok: false, reason: "too-small" });
  });
});

describe("activeCardEditor", () => {
  it("is the canvas surface's card only", () => {
    const ui = { editingNodeId: "card-1", editingField: "title" as const, canEditContent: true };
    expect(activeCardEditor({ ...ui, editingSurface: "canvas" })).toEqual({
      cardId: "card-1",
      field: "title",
    });
    expect(activeCardEditor({ ...ui, editingSurface: "panel" })).toBeNull();
    expect(activeCardEditor({ ...ui, editingSurface: "focus" })).toBeNull();
    expect(activeCardEditor({ ...ui, editingSurface: "canvas", editingNodeId: null })).toBeNull();
    expect(activeCardEditor({ ...ui, editingSurface: "canvas", canEditContent: false })).toBeNull();
  });
});

describe("the commit window", () => {
  it("coalesces a typing burst into one commit, and flushes the pending one", () => {
    vi.useFakeTimers();
    try {
      const commit = vi.fn();
      const barrier = createTextCommitBarrier({ commit });
      barrier.touch();
      barrier.touch();
      barrier.touch();
      expect(commit).not.toHaveBeenCalled();
      expect(barrier.pending).toBe(true);
      vi.advanceTimersByTime(ICE_CARD_EDITOR_COMMIT_MS);
      expect(commit).toHaveBeenCalledTimes(1);
      expect(barrier.pending).toBe(false);

      // A close flushes what is pending; an idle close writes nothing.
      barrier.touch();
      barrier.flush();
      expect(commit).toHaveBeenCalledTimes(2);
      barrier.flush();
      expect(commit).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops a pending commit when the card leaves the document", () => {
    vi.useFakeTimers();
    try {
      const commit = vi.fn();
      const barrier = createTextCommitBarrier({ commit, delayMs: 100 });
      barrier.touch();
      barrier.cancel();
      vi.advanceTimersByTime(1000);
      expect(commit).not.toHaveBeenCalled();
      expect(barrier.pending).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("isTypingTarget", () => {
  it("knows a field, a select and a rich-text surface from a plain element", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("attachCardEditorOpeners", () => {
  const attached: Array<() => void> = [];
  afterEach(() => {
    while (attached.length > 0) attached.pop()?.();
    document.body.replaceChildren();
  });

  function harness(overrides: Partial<IceCardEditorOpeners> = {}) {
    const root = document.createElement("div");
    root.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 50,
        right: 900,
        bottom: 650,
        width: 800,
        height: 600,
        x: 100,
        y: 50,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.append(root);
    const open = vi.fn();
    const openers: IceCardEditorOpeners = {
      cardAt: (point) => (point.x === 40 && point.y === 60 ? CARD : null),
      selectedCard: () => CARD,
      plan: () => ({ ok: true, field: "body" }),
      isEditing: () => false,
      editorElement: () => null,
      open,
      ...overrides,
    };
    attached.push(attachCardEditorOpeners({ root }, openers));
    return { root, open };
  }

  function doubleClick(root: HTMLElement, clientX = 140, clientY = 110): void {
    root.dispatchEvent(new MouseEvent("dblclick", { clientX, clientY, bubbles: true }));
  }

  function pressEnter(target: EventTarget = window): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  }

  it("opens the card a double click lands on, in container coordinates", () => {
    const { root, open } = harness();
    doubleClick(root);
    expect(open).toHaveBeenCalledWith(CARD, "body");
  });

  it("opens nothing on a double click that missed a card", () => {
    const { root, open } = harness();
    doubleClick(root, 700, 500);
    expect(open).not.toHaveBeenCalled();
  });

  it("opens nothing when the gate refuses (a viewer, a whiteboard, too small)", () => {
    const { root, open } = harness({ plan: () => ({ ok: false, reason: "read-only" }) });
    doubleClick(root);
    pressEnter();
    expect(open).not.toHaveBeenCalled();
  });

  it("opens the one selected card on Enter, and claims the key from the desk", () => {
    const { open } = harness();
    const event = pressEnter();
    expect(open).toHaveBeenCalledWith(CARD, "body");
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves Enter alone for a multi-selection", () => {
    const { open } = harness({ selectedCard: () => null });
    pressEnter();
    expect(open).not.toHaveBeenCalled();
  });

  it("leaves Enter alone for a surface that is not the desk", () => {
    const { open } = harness();
    const button = document.createElement("button");
    document.body.append(button);
    pressEnter(button);
    expect(open).not.toHaveBeenCalled();
  });

  it("leaves Enter alone inside a field", () => {
    const { open } = harness();
    const input = document.createElement("input");
    document.body.append(input);
    pressEnter(input);
    expect(open).not.toHaveBeenCalled();
  });

  it("leaves Enter alone when something already handled it", () => {
    const { open } = harness();
    const prevented = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    prevented.preventDefault();
    window.dispatchEvent(prevented);
    expect(open).not.toHaveBeenCalled();
  });

  it("leaves Enter alone while an editor is already open", () => {
    const { open } = harness({ isEditing: () => true });
    pressEnter();
    expect(open).not.toHaveBeenCalled();
  });

  it("never re-opens from a press inside the editor it already has open", () => {
    const editor = document.createElement("div");
    editor.append(document.createElement("span"));
    const { root, open } = harness({ editorElement: () => editor });
    root.append(editor);
    editor.dispatchEvent(new MouseEvent("dblclick", { clientX: 140, clientY: 110, bubbles: true }));
    expect(open).not.toHaveBeenCalled();
  });

  it("stops listening on teardown", () => {
    const { root, open } = harness();
    attached.pop()?.();
    doubleClick(root);
    pressEnter();
    expect(open).not.toHaveBeenCalled();
  });
});
