import { afterEach, describe, expect, it, vi } from "vitest";
import {
  easeAlpha,
  easeToward,
  LOCAL_EASE_SNAP_PX,
  LOCAL_EASE_TAU_MS,
  LocalDragEase,
  prefersReducedMotion,
} from "./localEasing";

/**
 * Manual 60 Hz / 120 Hz check for A10 §6.4: the automated suite asserts the
 * maths and the single commit, not frame pacing. To feel the difference, open a
 * board, drag a card, and toggle Chrome's rendering FPS meter
 * (Rendering → Frame Rendering Stats) while switching the display between 60 and
 * 120 Hz. The card should end under the pointer on both, with no visible step and
 * no bounce at release; with "Emulate CSS prefers-reduced-motion" enabled it
 * should track the pointer with no easing at all.
 */
describe("easeAlpha", () => {
  it("covers more ground for a longer frame and nothing for no time", () => {
    expect(easeAlpha(0)).toBe(0);
    expect(easeAlpha(-5)).toBe(0);
    expect(easeAlpha(Number.NaN)).toBe(0);
    const shortFrame = easeAlpha(1000 / 120);
    const longFrame = easeAlpha(1000 / 60);
    expect(shortFrame).toBeGreaterThan(0);
    expect(shortFrame).toBeLessThan(longFrame);
    expect(longFrame).toBeLessThan(1);
  });

  it("lands on the same place at the same wall-clock time on 60 Hz and 120 Hz", () => {
    const drag = (framesPerSecond: number) => {
      const dt = 1000 / framesPerSecond;
      let point = { x: 0, y: 0 };
      const target = { x: 300, y: 0 };
      // 100 ms of samples, one per refresh.
      for (let elapsed = 0; elapsed < 100; elapsed += dt) {
        point = easeToward(point, target, easeAlpha(dt)).position;
      }
      return point.x;
    };
    // The 120 Hz run gets twice the samples in the same time; the position after
    // 100 ms must match within a pixel.
    expect(Math.abs(drag(60) - drag(120))).toBeLessThan(1);
  });

  it("uses a short time constant, so the render trails by a fraction of a frame", () => {
    expect(LOCAL_EASE_TAU_MS).toBeLessThan(1000 / 60);
    expect(easeAlpha(1000 / 60)).toBeGreaterThan(0.7);
    expect(easeAlpha(1000 / 120)).toBeGreaterThan(0.45);
  });
});

describe("easeToward", () => {
  it("moves a fraction of the remaining distance", () => {
    const next = easeToward({ x: 0, y: 10 }, { x: 100, y: 10 }, 0.5);
    expect(next.settled).toBe(false);
    expect(next.position).toEqual({ x: 50, y: 10 });
  });

  it("settles exactly on the target once inside the snap distance", () => {
    const next = easeToward({ x: 100 - LOCAL_EASE_SNAP_PX / 2, y: 0 }, { x: 100, y: 0 }, 0.1);
    expect(next.settled).toBe(true);
    expect(next.position).toEqual({ x: 100, y: 0 });
  });

  it("does not overshoot at full alpha", () => {
    expect(easeToward({ x: 3, y: 3 }, { x: 9, y: -1 }, 1)).toEqual({
      position: { x: 9, y: -1 },
      settled: true,
    });
  });
});

describe("LocalDragEase", () => {
  it("starts at the committed position, so the first frame does not jump", () => {
    const ease = new LocalDragEase();
    ease.begin([{ id: "a", position: { x: 10, y: 20 } }], 100);
    expect(ease.renderedAt("a")).toEqual({ x: 10, y: 20 });
    expect(ease.moving).toBe(false);
    expect(ease.step(100).size).toBe(0);
  });

  it("eases the rendered position toward the pointer over several frames", () => {
    const ease = new LocalDragEase();
    ease.begin([{ id: "a", position: { x: 0, y: 0 } }], 0);
    ease.target("a", { x: 120, y: 0 });

    const first = ease.step(16.7).get("a");
    expect(first?.x).toBeGreaterThan(0);
    expect(first?.x).toBeLessThan(120);

    let now = 16.7;
    for (let frame = 0; frame < 30 && ease.moving; frame += 1) {
      now += 16.7;
      ease.step(now);
    }
    expect(ease.moving).toBe(false);
    expect(ease.renderedAt("a")).toEqual({ x: 120, y: 0 });
  });

  it("follows a moving target and ends on the last pointer sample", () => {
    const ease = new LocalDragEase();
    ease.begin([{ id: "a", position: { x: 0, y: 0 } }]);
    let now = 0;
    for (let x = 10; x <= 100; x += 10) {
      now += 16.7;
      ease.target("a", { x, y: x / 2 });
      ease.step(now);
    }
    const committed = ease.finish();
    // The commit is the pointer truth, not where the easing had rendered to.
    expect(committed.get("a")).toEqual({ x: 100, y: 50 });
  });

  it("hands back the pointer positions once and forgets the gesture", () => {
    const ease = new LocalDragEase();
    ease.begin([{ id: "a", position: { x: 0, y: 0 } }]);
    ease.target("a", { x: 40, y: 40 });
    expect(ease.finish().get("a")).toEqual({ x: 40, y: 40 });
    // A second call cannot hand back a commit: one drop is one commit.
    expect(ease.finish().size).toBe(0);
    expect(ease.active).toBe(false);
    expect(ease.moving).toBe(false);
  });

  it("ignores cards it did not start with", () => {
    const ease = new LocalDragEase();
    ease.begin([{ id: "a", position: { x: 0, y: 0 } }]);
    ease.target("b", { x: 5, y: 5 });
    expect(ease.tracks("b")).toBe(false);
    expect(ease.step(16.7).has("b")).toBe(false);
    expect(ease.finish().has("b")).toBe(false);
  });

  it("eases every card of a multi-card drag", () => {
    const ease = new LocalDragEase();
    ease.begin([
      { id: "a", position: { x: 0, y: 0 } },
      { id: "b", position: { x: 0, y: 200 } },
    ]);
    ease.target("a", { x: 50, y: 50 });
    ease.target("b", { x: 50, y: 250 });
    const moved = ease.step(16.7);
    expect([...moved.keys()].sort()).toEqual(["a", "b"]);
    const committed = ease.finish();
    expect(committed.get("b")).toEqual({ x: 50, y: 250 });
  });
});

describe("prefersReducedMotion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.motion;
  });

  it("reports the media query result", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    expect(prefersReducedMotion()).toBe(true);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(prefersReducedMotion()).toBe(false);
  });

  it("is false when the environment has no media queries", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
  });

  /**
   * Appearance writes `data-motion` on the document root. CSS honours it, and a
   * script that only asked the OS ignored the reader's own setting: an in-app
   * "reduced" choice has to reach JavaScript too.
   */
  it("honours the app's own motion preference", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));

    document.documentElement.dataset.motion = "full";
    expect(prefersReducedMotion()).toBe(false);

    document.documentElement.dataset.motion = "reduced";
    expect(prefersReducedMotion()).toBe(true);
  });

  it("stays reduced when either source asks for it", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    document.documentElement.dataset.motion = "full";
    expect(prefersReducedMotion()).toBe(true);

    document.documentElement.dataset.motion = "reduced";
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(prefersReducedMotion()).toBe(true);
  });
});
