import { describe, expect, it, vi } from "vitest";
import {
  createSuiteCardOverlay,
  escalateToDom,
  normalizeDpr,
  SUITE_CARD_COMPACT_SCREEN_WIDTH,
  SUITE_CARD_FULL_SCREEN_WIDTH,
  SUITE_CARD_INK_PAGE,
  type SuiteCardGeometry,
  type SuiteCardRect,
  sharpCeiling,
  suiteCardBand,
  suiteCardBox,
  suiteCardBoxFromRect,
} from "./suiteCardOverlay";

function geometry(overrides: Partial<SuiteCardGeometry> = {}): SuiteCardGeometry {
  return { centre: [300, 150], half: [144, 120], angle: Math.PI / 2, ...overrides };
}

describe("suiteCardBox", () => {
  it("maps ICE's camera to a screen box and keeps the world size for layout", () => {
    const box = suiteCardBox(geometry(), { x: 100, y: 50, zoom: 2 });
    expect(box).not.toBeNull();
    expect(box).toEqual({
      left: 112,
      top: -40,
      width: 576,
      height: 480,
      worldWidth: 288,
      worldHeight: 240,
      scale: 2,
      angleDeg: 90,
      band: "full",
      escalated: false,
    });
  });

  it("bands a shrink instead of hiding it: full, then compact, then glyph", () => {
    // 288 world units × 0.6 = 172.8px: under the full card, still a face.
    const compact = suiteCardBox(geometry(), { x: 0, y: 0, zoom: 0.6 });
    expect(compact?.band).toBe("compact");
    expect(compact?.width).toBeCloseTo(172.8);
    // 288 × 0.625 = 180px exactly is the full card.
    const full = suiteCardBox(geometry(), { x: 0, y: 0, zoom: 0.625 });
    expect(full?.band).toBe("full");
    expect(full?.width).toBe(SUITE_CARD_FULL_SCREEN_WIDTH);
    // 288 × 0.1 = 28.8px: a glyph, still positioned in its own footprint.
    expect(suiteCardBox(geometry(), { x: 0, y: 0, zoom: 0.1 })?.band).toBe("icon");
    expect(suiteCardBand(SUITE_CARD_COMPACT_SCREEN_WIDTH)).toBe("compact");
    expect(suiteCardBand(0)).toBe("icon");
    expect(suiteCardBand(Number.NaN)).toBe("icon");
  });

  it("positions from the canonical rect, which carries no paper lift", () => {
    const rect: SuiteCardRect = { x: 40, y: 60, w: 288, h: 240 };
    expect(suiteCardBoxFromRect(rect, { x: 10, y: 20, zoom: 2 })).toEqual({
      left: 60,
      top: 80,
      width: 576,
      height: 480,
      worldWidth: 288,
      worldHeight: 240,
      scale: 2,
      angleDeg: 0,
      band: "full",
      escalated: false,
    });
    expect(suiteCardBoxFromRect(null, { x: 0, y: 0, zoom: 1 })).toBeNull();
    expect(suiteCardBoxFromRect(rect, { x: 0, y: 0, zoom: 0 })).toBeNull();
    expect(suiteCardBoxFromRect({ ...rect, w: Number.NaN }, { x: 0, y: 0, zoom: 1 })).toBeNull();
  });

  it("refuses missing or nonsensical geometry and a faded object", () => {
    expect(suiteCardBox(undefined, { x: 0, y: 0, zoom: 1 })).toBeNull();
    expect(suiteCardBox(geometry(), undefined)).toBeNull();
    expect(suiteCardBox(geometry(), { x: 0, y: 0, zoom: 0 })).toBeNull();
    expect(suiteCardBox(geometry({ alpha: 0 }), { x: 0, y: 0, zoom: 1 })).toBeNull();
    expect(suiteCardBox(geometry({ half: [Number.NaN, 120] }), { x: 0, y: 0, zoom: 1 })).toBeNull();
  });
});

describe("the sharp ceiling", () => {
  it("should be the ink page divided by the device pixel ratio", () => {
    expect(SUITE_CARD_INK_PAGE).toBe(2048);
    expect(sharpCeiling(1)).toBe(2048);
    expect(sharpCeiling(1.5)).toBeCloseTo(2048 / 1.5, 6);
    expect(sharpCeiling(2)).toBe(1024);
    expect(sharpCeiling(3)).toBeCloseTo(2048 / 3, 6);
    // A nonsense ratio is a plain 1x screen: the sheet is never given 0 width.
    expect(sharpCeiling(0)).toBe(2048);
    expect(sharpCeiling(-2)).toBe(2048);
    expect(sharpCeiling(Number.NaN)).toBe(2048);
    expect(normalizeDpr(undefined)).toBe(1);
    expect(normalizeDpr(1.5)).toBe(1.5);
  });

  it("should escalate only past the ceiling, at every ratio", () => {
    for (const dpr of [1, 1.5, 2, 3]) {
      const ceiling = sharpCeiling(dpr);
      expect(escalateToDom(ceiling - 1, dpr)).toBe(false);
      // Exactly at the ceiling the sheet is still sharp: no switch, no flicker.
      expect(escalateToDom(ceiling, dpr)).toBe(false);
      expect(escalateToDom(ceiling + 1, dpr)).toBe(true);
    }
    expect(escalateToDom(Number.NaN, 1)).toBe(false);
  });

  it("should never let escalation fight the LOD bands", () => {
    // 150px is a compact card on a 1x screen, however small the ceiling is.
    expect(suiteCardBand(150)).toBe("compact");
    expect(escalateToDom(150, 100)).toBe(false);
    expect(escalateToDom(SUITE_CARD_COMPACT_SCREEN_WIDTH, 100)).toBe(false);
    // The full band is the only one that escalates.
    expect(escalateToDom(SUITE_CARD_FULL_SCREEN_WIDTH, 100)).toBe(true);
  });

  it("should mark the box escalated past the ceiling, at full only", () => {
    // 288 world units at 8x = 2304px, past the 2048px ceiling of a 1x screen.
    const wide = suiteCardBox(geometry(), { x: 0, y: 0, zoom: 8 }, 0, 1);
    expect(wide?.band).toBe("full");
    expect(wide?.escalated).toBe(true);
    // The same box on a 2x screen: 2304 > 1024, still escalated.
    expect(suiteCardBox(geometry(), { x: 0, y: 0, zoom: 8 }, 0, 2)?.escalated).toBe(true);
    // At 4x (1152px) a 1x screen is still under its ceiling.
    expect(suiteCardBox(geometry(), { x: 0, y: 0, zoom: 4 }, 0, 1)?.escalated).toBe(false);
    expect(suiteCardBox(geometry(), { x: 0, y: 0, zoom: 4 }, 0, 2)?.escalated).toBe(true);
    // The canonical rect path agrees with the geometry path.
    const rect: SuiteCardRect = { x: 0, y: 0, w: 288, h: 240 };
    expect(suiteCardBoxFromRect(rect, { x: 0, y: 0, zoom: 8 }, 1)?.escalated).toBe(true);
    expect(suiteCardBoxFromRect(rect, { x: 0, y: 0, zoom: 1 }, 4)?.escalated).toBe(false);
  });
});

describe("createSuiteCardOverlay escalation", () => {
  /** Two cards at one camera: a normal one and one far past the ceiling. */
  function twoCards(options: { escalatedOnly?: boolean; dpr?: number } = {}) {
    const container = document.createElement("div");
    document.body.append(container);
    const rects = new Map<number, SuiteCardRect>([
      [1, { x: 0, y: 0, w: 288, h: 240 }],
      [2, { x: 0, y: 0, w: 3000, h: 2400 }],
    ]);
    const overlay = createSuiteCardOverlay({
      container,
      entities: () => [1, 2],
      geometryOf: () => geometry(),
      rectOf: (entity) => rects.get(entity) ?? null,
      camera: () => ({ x: 0, y: 0, zoom: 1 }),
      ...(options.dpr === undefined ? {} : { dpr: () => options.dpr }),
      ...(options.escalatedOnly === undefined ? {} : { escalatedOnly: options.escalatedOnly }),
    });
    return { container, overlay };
  }

  it("should mount only the cards the sheet can no longer draw sharply", () => {
    const { container, overlay } = twoCards({ escalatedOnly: true, dpr: 1 });
    overlay.sync();
    expect(overlay.visibleCount()).toBe(1);
    expect(overlay.escalatedCount()).toBe(1);
    const normal = container.querySelector<HTMLElement>('[data-entity="1"]');
    const wide = container.querySelector<HTMLElement>('[data-entity="2"]');
    expect(normal?.dataset.visible).toBe("false");
    expect(wide?.dataset.visible).toBe("true");
    expect(wide?.dataset.escalated).toBe("true");
    overlay.dispose();
    container.remove();
  });

  it("should keep every card when it is not escalated-only", () => {
    const { container, overlay } = twoCards({ dpr: 1 });
    overlay.sync();
    expect(overlay.visibleCount()).toBe(2);
    expect(overlay.escalatedCount()).toBe(1);
    // A 3000px card is sharp on a 2x screen: the ceiling follows the ratio.
    overlay.dispose();
    container.remove();

    const big = twoCards({ dpr: 2 });
    big.overlay.sync();
    expect(big.overlay.visibleCount()).toBe(2);
    expect(big.overlay.escalatedCount()).toBe(1);
    big.overlay.dispose();
    big.container.remove();
  });

  it("should hand the escalated flag to the slot renderer", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const seen: Array<{ entity: number; escalated: boolean }> = [];
    const overlay = createSuiteCardOverlay({
      container,
      entities: () => [1, 2],
      geometryOf: () => geometry(),
      rectOf: (entity) =>
        entity === 1 ? { x: 0, y: 0, w: 288, h: 240 } : { x: 0, y: 0, w: 3000, h: 2400 },
      camera: () => ({ x: 0, y: 0, zoom: 1 }),
      dpr: () => 1,
      renderer: {
        mount: (_content, info) => {
          seen.push({ entity: info.entity, escalated: info.escalated });
          return undefined;
        },
      },
    });
    overlay.sync();
    expect(seen).toEqual([
      { entity: 1, escalated: false },
      { entity: 2, escalated: true },
    ]);
    overlay.dispose();
    container.remove();
  });
});

describe("createSuiteCardOverlay", () => {
  it("keeps a slot at every band and swaps its content in place", () => {
    const container = document.createElement("div");
    document.body.append(container);
    let entities = [7];
    let camera = { x: 0, y: 0, zoom: 1 };
    const geo: SuiteCardGeometry | undefined = geometry();
    const mounts: Array<{ entity: number; band: string }> = [];
    const cleanups: number[] = [];
    const renderer = {
      mount: (_content: HTMLElement, info: { entity: number; band: string }) => {
        mounts.push({ entity: info.entity, band: info.band });
        return () => {
          cleanups.push(info.entity);
        };
      },
    };

    const overlay = createSuiteCardOverlay({
      container,
      entities: () => entities,
      geometryOf: () => geo,
      camera: () => camera,
      infoOf: () => ({ title: "T", body: "B" }),
      renderer,
    });

    overlay.sync();
    expect(overlay.visibleCount()).toBe(1);
    expect(mounts).toEqual([{ entity: 7, band: "full" }]);
    const slot = container.querySelector<HTMLElement>('[data-entity="7"]');
    expect(slot).not.toBeNull();
    expect(slot?.style.left).toBe("156px");
    expect(slot?.style.top).toBe("30px");
    expect(slot?.style.width).toBe("288px");
    expect(slot?.style.height).toBe("240px");
    expect(slot?.dataset.visible).toBe("true");
    expect(slot?.dataset.band).toBe("full");
    // Re-syncing at the same camera does not remount the content.
    overlay.sync();
    expect(mounts).toEqual([{ entity: 7, band: "full" }]);

    // Zoomed out past the full card: the slot STAYS, its content becomes the
    // static face. Nothing is hidden, so a card never pops out of existence.
    camera = { x: 0, y: 0, zoom: 0.4 };
    overlay.sync();
    expect(overlay.visibleCount()).toBe(1);
    expect(cleanups).toEqual([7]);
    expect(mounts).toEqual([
      { entity: 7, band: "full" },
      { entity: 7, band: "compact" },
    ]);
    expect(slot?.style.display).toBe("block");
    expect(slot?.dataset.visible).toBe("true");
    expect(slot?.dataset.band).toBe("compact");
    expect(slot?.style.width).toBe("115.2px");

    // Far out: a glyph, still in the card's own footprint.
    camera = { x: 0, y: 0, zoom: 0.1 };
    overlay.sync();
    expect(slot?.dataset.band).toBe("icon");

    // Back at a readable zoom: the live face again.
    camera = { x: 0, y: 0, zoom: 1 };
    overlay.sync();
    expect(overlay.visibleCount()).toBe(1);
    expect(mounts.at(-1)).toEqual({ entity: 7, band: "full" });

    // A dead entity's slot goes away entirely.
    entities = [];
    overlay.sync();
    expect(container.querySelector('[data-entity="7"]')).toBeNull();

    overlay.dispose();
    expect(container.querySelector(".suite-card-overlay")).toBeNull();
    container.remove();
  });

  it("passes the card's ids to the slot renderer, defaulting them when absent", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const seen: Array<{ entity: number; cardId: string; boardId: string }> = [];

    const withIds = createSuiteCardOverlay({
      container,
      entities: () => [7],
      geometryOf: () => geometry(),
      camera: () => ({ x: 0, y: 0, zoom: 1 }),
      infoOf: () => ({ title: "T", body: "B", cardId: "card-7", boardId: "board-3" }),
      renderer: {
        mount: (_content, info) => {
          seen.push({ entity: info.entity, cardId: info.cardId, boardId: info.boardId });
          return undefined;
        },
      },
    });
    withIds.sync();
    expect(seen).toEqual([{ entity: 7, cardId: "card-7", boardId: "board-3" }]);
    withIds.dispose();
    seen.length = 0;

    // A face without ids (the lab's string-only card) reports empty strings, so
    // a production renderer can tell it has nothing to bind.
    const withoutIds = createSuiteCardOverlay({
      container,
      entities: () => [8],
      geometryOf: () => geometry(),
      camera: () => ({ x: 0, y: 0, zoom: 1 }),
      infoOf: () => ({ title: "T", body: "B" }),
      renderer: {
        mount: (_content, info) => {
          seen.push({ entity: info.entity, cardId: info.cardId, boardId: info.boardId });
          return undefined;
        },
      },
    });
    withoutIds.sync();
    expect(seen).toEqual([{ entity: 8, cardId: "", boardId: "" }]);
    withoutIds.dispose();
    container.remove();
  });

  it("renders the minimal card as text when no React renderer is registered", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const overlay = createSuiteCardOverlay({
      container,
      entities: () => [1],
      geometryOf: () => geometry(),
      camera: () => ({ x: 0, y: 0, zoom: 1 }),
      infoOf: () => ({ title: "Lab title", body: "Lab body" }),
    });
    overlay.sync();
    const card = container.querySelector('[data-testid="suite-card-overlay-card"]');
    expect(card?.textContent).toContain("Lab title");
    expect(card?.textContent).toContain("Lab body");
    overlay.dispose();
    container.remove();
  });

  it("never lets a stale slot survive dispose", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const cleanup = vi.fn();
    const overlay = createSuiteCardOverlay({
      container,
      entities: () => [3],
      geometryOf: () => geometry(),
      camera: () => ({ x: 0, y: 0, zoom: 1 }),
      renderer: { mount: () => cleanup },
    });
    overlay.sync();
    overlay.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(container.childElementCount).toBe(0);
    container.remove();
  });
});
