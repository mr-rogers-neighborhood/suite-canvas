import { boardColors } from "@suite/graph";
import { describe, expect, it } from "vitest";
import {
  BOARD_DEPTH_MAX_LEVEL,
  BOARD_DEPTH_STEP_PX,
  type BoardFaceLayout,
  boardAccent,
  boardDepthOffset,
  boardFaceBand,
  boardFaceLayout,
  createSuiteBoardFaceLayer,
  SUITE_BOARD_FACE_ACCENT_FALLBACK,
  SUITE_BOARD_FACE_ACCENT_HEIGHT,
  SUITE_BOARD_FACE_ACCENT_TAB,
  SUITE_BOARD_FACE_CHIP,
  SUITE_BOARD_FACE_TITLE,
  SUITE_BOARD_FACE_UNTITLED,
  type SuiteBoardFaceNode,
} from "./suiteBoardFace";

/** A Board's mat at world (100, 50), 640 × 480 — the kind's own footprint. */
const mat = { x: 100, y: 50, width: 640, height: 480 };

function layout(overrides: Partial<Parameters<typeof boardFaceLayout>[0]> = {}): BoardFaceLayout {
  return boardFaceLayout({
    x: mat.x,
    y: mat.y,
    width: mat.width,
    height: mat.height,
    zoom: 1,
    depth: 0,
    name: "Research",
    color: "blue",
    childCount: 0,
    ...overrides,
  });
}

function node(overrides: Partial<SuiteBoardFaceNode> = {}): SuiteBoardFaceNode {
  return {
    id: "board:1",
    rect: mat,
    depth: 0,
    name: "Research",
    color: "blue",
    cardCount: 4,
    childCount: 0,
    collapsed: false,
    ...overrides,
  };
}

describe("boardAccent", () => {
  it("should map every board colour to its own token", () => {
    const seen = new Set<string>();
    for (const color of boardColors) {
      const accent = boardAccent(color);
      expect(accent).toContain(`var(--section-${color}`);
      seen.add(accent);
    }
    // Six colours, six accents — no two boards share one by accident.
    expect(seen.size).toBe(boardColors.length);
  });

  it("should refuse a colour the palette does not define", () => {
    expect(boardAccent(undefined)).toBe(SUITE_BOARD_FACE_ACCENT_FALLBACK);
    expect(boardAccent("url(javascript:alert(1))")).toBe(SUITE_BOARD_FACE_ACCENT_FALLBACK);
    expect(boardAccent("constructor")).toBe(SUITE_BOARD_FACE_ACCENT_FALLBACK);
  });
});

describe("boardFaceBand", () => {
  it("should keep the name from fit zoom outward and chips only up close", () => {
    expect(boardFaceBand(1)).toBe("full");
    expect(boardFaceBand(0.4)).toBe("full");
    expect(boardFaceBand(0.39)).toBe("compact");
    // Fit zoom (0.12) and the graph band (≈0.06) both keep the name.
    expect(boardFaceBand(0.12)).toBe("compact");
    expect(boardFaceBand(0.06)).toBe("compact");
    expect(boardFaceBand(0.04)).toBe("compact");
  });

  it("should hide a face the camera cannot place", () => {
    expect(boardFaceBand(0.039)).toBe("hidden");
    expect(boardFaceBand(0)).toBe("hidden");
    expect(boardFaceBand(-1)).toBe("hidden");
    expect(boardFaceBand(Number.NaN)).toBe("hidden");
    expect(boardFaceBand(undefined)).toBe("hidden");
  });
});

describe("boardFaceLayout", () => {
  it("should draw the mat on its own footprint and the name above its top edge", () => {
    const face = layout();
    expect(face.band).toBe("full");
    expect(face.mat).toMatchObject({ left: 100, top: 50, width: 640, height: 480 });
    expect(face.title).not.toBeNull();
    if (face.title === null) return;
    // Directly above the mat, one gap clear of its edge, never overlapping it.
    expect(face.title.top + face.title.height + SUITE_BOARD_FACE_TITLE.gap).toBe(face.mat.top);
    expect(face.title.left).toBe(face.mat.left);
    expect(face.title.text).toBe("Research");
    expect(face.title.height).toBe(SUITE_BOARD_FACE_TITLE.height);
  });

  it("should keep the name legible over a mat too small to hold it", () => {
    const tiny = layout({ width: 8, height: 6, zoom: 0.06 });
    expect(tiny.title?.width).toBe(SUITE_BOARD_FACE_TITLE.minWidth);
    // A name never widens past its ceiling, however wide the Board is.
    expect(layout({ width: 4000 }).title?.width).toBe(SUITE_BOARD_FACE_TITLE.maxWidth);
  });

  it("should name an untitled Board rather than draw an empty title", () => {
    expect(layout({ name: "   " }).title?.text).toBe(SUITE_BOARD_FACE_UNTITLED);
  });

  it("should put the colour on a short tab inside the mat's top-left corner", () => {
    const face = layout({ color: "rose" });
    expect(face.accentColor).toContain("--section-rose");
    // A tab, not a rule across the whole mat: a full-width bar reads as a stray
    // line lying over the canvas rather than as the mat's own label stripe.
    expect(face.accent).toEqual({
      left: face.mat.left + SUITE_BOARD_FACE_ACCENT_TAB.inset,
      top: face.mat.top + SUITE_BOARD_FACE_ACCENT_TAB.inset,
      width: SUITE_BOARD_FACE_ACCENT_TAB.width,
      height: SUITE_BOARD_FACE_ACCENT_HEIGHT,
    });
    expect(face.accent?.width).toBeLessThan(face.mat.width);
  });

  it("should keep the tab inside a Board narrower than the tab itself", () => {
    const face = layout({ width: 40, height: 30 });

    expect(face.accent?.width).toBeLessThanOrEqual(40);
    expect(face.accent?.height).toBeGreaterThanOrEqual(0);
  });

  it("should stack one plate per shallower level behind the mat", () => {
    const flat = layout({ depth: 0 });
    expect(flat.plates).toEqual([]);

    const nested = layout({ depth: 2 });
    expect(nested.plates.map((plate) => plate.level)).toEqual([0, 1]);
    const [surface, first] = nested.plates;
    expect(surface).toBeDefined();
    expect(first).toBeDefined();
    if (surface === undefined || first === undefined) return;
    // The mat is the top of the pile: every plate is the same size, one step
    // further down and right the shallower it is — a sheet under the mat, never
    // a shrunken copy of it.
    expect(nested.mat).toMatchObject({ left: 100, top: 50, width: 640, height: 480 });
    expect(surface.left).toBe(100 + 2 * BOARD_DEPTH_STEP_PX);
    expect(surface.top).toBe(50 + 2 * BOARD_DEPTH_STEP_PX);
    expect(first.left).toBe(100 + BOARD_DEPTH_STEP_PX);
    expect(first.top).toBe(50 + BOARD_DEPTH_STEP_PX);
    expect(first.left).toBeLessThan(surface.left);
    expect(first.width).toBe(surface.width);
    expect(first.height).toBe(surface.height);
    // The mat is the top of the pile, so it throws the deepest shadow.
    expect(nested.mat.shadow).toBeGreaterThan(0);
    expect(nested.mat.shadow).toBe(boardDepthOffset(2).shadow);
  });

  it("should clamp the stack at the deepest drawn level", () => {
    const deep = layout({ depth: 99 });
    // Past a few plates the pile stops reading as a pile, so depth is capped.
    expect(deep.plates).toHaveLength(BOARD_DEPTH_MAX_LEVEL);
    expect(deep.mat.level).toBe(BOARD_DEPTH_MAX_LEVEL);
  });

  it("should draw child chips only at the full band and only with room", () => {
    expect(layout({ childCount: 3, zoom: 0.2 }).chips).toEqual([]);
    expect(layout({ childCount: 0 }).chips).toEqual([]);

    const chips = layout({ childCount: 3 }).chips;
    expect(chips).toHaveLength(3);
    for (const chip of chips) {
      expect(chip.overflow).toBe(0);
      expect(chip.left).toBeGreaterThanOrEqual(100 + SUITE_BOARD_FACE_CHIP.inset);
      expect(chip.left + chip.width).toBeLessThanOrEqual(100 + 640);
      expect(chip.top + chip.height).toBeLessThanOrEqual(50 + 480);
    }
    // Laid end to end, in order, never overlapping.
    expect(chips[1]?.left).toBe(
      (chips[0]?.left ?? 0) + (chips[0]?.width ?? 0) + SUITE_BOARD_FACE_CHIP.gap,
    );
  });

  it("should stand the rest of a large family in as one +n chip", () => {
    const chips = layout({ childCount: 9 }).chips;
    expect(chips).toHaveLength(SUITE_BOARD_FACE_CHIP.max);
    expect(chips.at(-1)?.key).toBe("chip:more");
    expect(chips.at(-1)?.overflow).toBe(9 - (SUITE_BOARD_FACE_CHIP.max - 1));
    expect(chips.at(-1)?.overflow).toBeGreaterThan(0);
  });

  it("should advertise no children for a collapsed Board", () => {
    expect(layout({ childCount: 3, collapsed: true }).chips).toEqual([]);
  });

  it("should never produce a negative size, however small the mat", () => {
    for (const size of [0, 0.25, -10, Number.NaN]) {
      const face = layout({ width: size, height: size });
      expect(face.mat.width).toBeGreaterThanOrEqual(0);
      expect(face.mat.height).toBeGreaterThanOrEqual(0);
      expect(face.accent?.height ?? 0).toBeGreaterThanOrEqual(0);
      expect(face.title?.width ?? 0).toBeGreaterThanOrEqual(0);
      for (const chip of face.chips) {
        expect(chip.width).toBeGreaterThanOrEqual(0);
        expect(chip.height).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("should leave the mat's shape to the camera, not to a legible minimum", () => {
    // A Board is authored geometry: the face may not inflate a 6 px mat.
    const far = layout({ width: 6, height: 4, zoom: 0.01 });
    expect(far.band).toBe("hidden");
    expect(far.mat.width).toBe(6);
    expect(far.mat.height).toBe(4);
    expect(far.title).toBeNull();
    expect(far.accent).toBeNull();
  });
});

describe("createSuiteBoardFaceLayer", () => {
  function mount(nodes: SuiteBoardFaceNode[], zoom = 1, selected: readonly string[] = []) {
    const container = document.createElement("div");
    const current = { camera: { x: 0, y: 0, zoom } as { x: number; y: number; zoom: number } };
    const selection = { ids: new Set(selected) };
    const layer = createSuiteBoardFaceLayer({
      container,
      nodes: () => nodes,
      camera: () => current.camera,
      selected: (id) => selection.ids.has(id),
    });
    return { container, layer, current, selection };
  }

  it("should draw nothing at all for an unselected Board", () => {
    // The GPU mat is the Board: an idle canvas carries no overlay.
    const { container, layer } = mount([node(), node({ id: "board:2", name: "Actors" })]);
    layer.sync();

    const titles = container.querySelectorAll<HTMLElement>(
      '[data-testid="suite-board-face__title"]',
    );
    for (const title of titles) expect(title.style.display).toBe("none");
    expect(container.querySelectorAll('[data-testid="suite-board-face__chip"]')).toHaveLength(0);

    layer.dispose();
  });

  it("should name a Board while it is selected, and only then", () => {
    const nodes = [node(), node({ id: "board:2", rect: { ...mat, x: 900 }, name: "Actors" })];
    const { container, layer, selection } = mount(nodes, 1, ["board:1", "board:2"]);
    layer.sync();
    expect(layer.visibleCount()).toBe(2);

    const mats = container.querySelectorAll<HTMLElement>('[data-testid="suite-board-face"]');
    expect(mats).toHaveLength(2);
    expect(mats[0]?.style.left).toBe("100px");
    expect(mats[0]?.style.top).toBe("50px");
    expect(mats[0]?.style.width).toBe("640px");
    expect(mats[0]?.dataset.band).toBe("full");
    expect(mats[0]?.style.getPropertyValue("--suite-board-accent")).toContain("--section-blue");

    const titles = container.querySelectorAll<HTMLElement>(
      '[data-testid="suite-board-face__title"]',
    );
    expect(titles).toHaveLength(2);
    expect(titles[0]?.textContent).toContain("Research");
    expect(titles[1]?.textContent).toContain("Actors");

    // Deselect one: its name goes away, the other's stays.
    selection.ids.delete("board:1");
    layer.sync();
    expect(titles[0]?.style.display).toBe("none");
    expect(titles[1]?.style.display).toBe("flex");

    layer.dispose();
  });

  it("should draw the name from the compact band and never the chips", () => {
    const nodes = [node({ childCount: 2 })];
    const { container, layer, current } = mount(nodes, 0.1, ["board:1"]);
    layer.sync();
    expect(layer.visibleCount()).toBe(1);
    const title = container.querySelector<HTMLElement>('[data-testid="suite-board-face__title"]');
    expect(title?.dataset.band).toBe("compact");
    expect(title?.textContent).toContain("Research");
    // Chips were the last overlay on an idle Board; the count lives in the pill.
    expect(container.querySelectorAll('[data-testid="suite-board-face__chip"]')).toHaveLength(0);

    current.camera = { x: 0, y: 0, zoom: 1 };
    layer.sync();
    expect(container.querySelectorAll('[data-testid="suite-board-face__chip"]')).toHaveLength(0);
    layer.dispose();
  });

  it("should keep the depth plates mounted but never drawn", () => {
    // The layout still computes the stack (a future face may want it), but the
    // overlay itself draws nothing over the GPU mat: a pile of translucent
    // sheets on top of the canvas read as stickers.
    const nodes = [node({ depth: 2 })];
    const { container, layer } = mount(nodes);
    layer.sync();
    const plates = container.querySelectorAll<HTMLElement>(
      '[data-testid="suite-board-face__plate"]',
    );
    expect(plates).toHaveLength(2);
    for (const plate of plates) expect(plate.style.display).toBe("none");

    nodes[0] = node({ depth: 0 });
    layer.sync();
    for (const plate of container.querySelectorAll<HTMLElement>(
      '[data-testid="suite-board-face__plate"]',
    )) {
      expect(plate.style.display).toBe("none");
    }
    layer.dispose();
  });

  it("should mark a collapsed Board, draw no frame and no chips", () => {
    const nodes = [node({ collapsed: true, childCount: 3 })];
    const { container, layer } = mount(nodes, 1, ["board:1"]);
    layer.sync();
    const face = container.querySelector<HTMLElement>('[data-testid="suite-board-face"]');
    expect(face?.dataset.collapsed).toBe("true");
    // No frame at all any more: the mat underneath carries the Board's edge.
    expect(face?.style.display).toBe("none");
    expect(container.querySelectorAll('[data-testid="suite-board-face__chip"]')).toHaveLength(0);
    layer.dispose();
  });

  it("should hide a Board whose camera cannot place it rather than draw it at zero", () => {
    const { layer, current } = mount([node()]);
    layer.sync();
    expect(layer.visibleCount()).toBe(1);
    current.camera = { x: 0, y: 0, zoom: 0 };
    layer.sync();
    expect(layer.visibleCount()).toBe(0);
    layer.dispose();
  });

  it("should destroy a Board's elements when it leaves and its layer on dispose", () => {
    const nodes = [node()];
    const { container, layer } = mount(nodes);
    layer.sync();
    expect(container.querySelectorAll('[data-testid="suite-board-face"]')).toHaveLength(1);

    nodes.pop();
    layer.sync();
    expect(container.querySelectorAll('[data-testid="suite-board-face"]')).toHaveLength(0);

    layer.dispose();
    expect(container.querySelector('[data-testid="suite-board-face-layer"]')).toBeNull();
  });
});
