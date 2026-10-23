import { describe, expect, it, vi } from "vitest";
import {
  createSuiteCardOverlay,
  SUITE_CARD_COMPACT_SCREEN_WIDTH,
  SUITE_CARD_FULL_SCREEN_WIDTH,
  type SuiteCardGeometry,
  type SuiteCardRect,
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
