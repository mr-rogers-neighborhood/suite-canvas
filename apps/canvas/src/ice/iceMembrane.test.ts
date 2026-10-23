import { describe, expect, it } from "vitest";
import {
  atCeiling,
  COMMIT,
  cameraShare,
  MIN_CAMERA_SHARE,
  PULL_PER_PX,
  RELEASE_AFTER_MS,
  RESTING_MEMBRANE,
  RETURN,
  settleMembrane,
  stepMembrane,
} from "./iceMembrane";

const CEILING = 0.06;

function push(state = RESTING_MEMBRANE, deltaY = 100, now = 1000) {
  return stepMembrane({ state, deltaY, now, zoom: CEILING, ceilingZoom: CEILING });
}

/** Push repeatedly until the membrane reports a commit. */
function pushToCommit() {
  let result = { state: RESTING_MEMBRANE, action: "none", cameraShare: 1 } as ReturnType<
    typeof stepMembrane
  >;
  let now = 1000;
  for (let i = 0; i < 40 && result.action !== "commit"; i += 1) {
    now += 16;
    result = push(result.state, 100, now);
  }
  return { ...result, now };
}

describe("atCeiling", () => {
  it("is true only within a thousandth of the ceiling", () => {
    expect(atCeiling(CEILING, CEILING)).toBe(true);
    expect(atCeiling(CEILING * 1.0005, CEILING)).toBe(true);
    expect(atCeiling(CEILING * 1.2, CEILING)).toBe(false);
    expect(atCeiling(Number.NaN, CEILING)).toBe(false);
    expect(atCeiling(1, 0)).toBe(false);
  });
});

describe("cameraShare", () => {
  it("damps from full movement to the floor as the pull builds", () => {
    expect(cameraShare(0)).toBe(1);
    expect(cameraShare(1)).toBeCloseTo(MIN_CAMERA_SHARE);
    expect(cameraShare(0.5)).toBeLessThan(1);
    expect(cameraShare(0.5)).toBeGreaterThan(MIN_CAMERA_SHARE);
    expect(cameraShare(Number.NaN)).toBe(1);
  });
});

describe("stepMembrane", () => {
  it("ignores the wheel away from the ceiling", () => {
    const result = stepMembrane({
      state: RESTING_MEMBRANE,
      deltaY: 120,
      now: 10,
      zoom: 0.5,
      ceilingZoom: CEILING,
    });
    expect(result.action).toBe("none");
    expect(result.state.pull).toBe(0);
    expect(result.cameraShare).toBe(1);
  });

  it("accumulates a pull while pushing at the ceiling and keeps most of it back", () => {
    const first = push();
    expect(first.state.pull).toBeCloseTo(100 * PULL_PER_PX);
    expect(first.action).toBe("none");
    expect(first.cameraShare).toBeLessThan(1);
    const second = push(first.state, 100, 1020);
    expect(second.state.pull).toBeGreaterThan(first.state.pull);
  });

  it("commits once the pull reaches the threshold, and only then", () => {
    const { action, state } = pushToCommit();
    expect(action).toBe("commit");
    expect(state.committed).toBe(true);
    // One extra notch before the threshold must not commit.
    const justUnder = stepMembrane({
      state: { pull: COMMIT - 0.01, committed: false, lastInputAt: 0 },
      deltaY: 1,
      now: 10,
      zoom: CEILING,
      ceilingZoom: CEILING,
    });
    expect(justUnder.action).toBe("none");
  });

  it("returns when the user zooms in from the graph, but not on a single notch", () => {
    const committed = pushToCommit().state;
    const notch = stepMembrane({
      state: committed,
      deltaY: -120,
      now: 5000,
      zoom: CEILING,
      ceilingZoom: CEILING,
    });
    expect(notch.action).toBe("none");
    expect(notch.state.committed).toBe(true);
    expect(notch.state.pull).toBeLessThan(1);

    const result = stepMembrane({
      state: notch.state,
      deltaY: -400,
      now: 5100,
      zoom: CEILING,
      ceilingZoom: CEILING,
    });
    expect(result.action).toBe("release");
    expect(result.state).toEqual({ pull: 0, committed: false, lastInputAt: 5100 });
  });

  it("unwinds a pull that never committed when the wheel reverses", () => {
    const pulled = push(undefined, 200, 1000).state;
    const back = stepMembrane({
      state: pulled,
      deltaY: -400,
      now: 1100,
      zoom: CEILING,
      ceilingZoom: CEILING,
    });
    expect(back.state.pull).toBe(0);
    // Nothing was committed, so there is nothing to release: the pull just ends.
    expect(back.action).toBe("none");
  });

  it("does not flap when the wheel wobbles at the threshold", () => {
    // Hold a committed graph and wobble one notch each way around RETURN.
    let state = pushToCommit().state;
    let now = 3000;
    for (let i = 0; i < 10; i += 1) {
      now += 16;
      const out = stepMembrane({ state, deltaY: 4, now, zoom: CEILING, ceilingZoom: CEILING });
      state = out.state;
      now += 16;
      const back = stepMembrane({ state, deltaY: -4, now, zoom: CEILING, ceilingZoom: CEILING });
      state = back.state;
      expect(back.action).not.toBe("commit");
    }
    // A tiny wobble never released it: the two thresholds are far apart.
    expect(state.committed).toBe(true);
  });
});

describe("settleMembrane", () => {
  it("does nothing before the release delay", () => {
    const pulled = push(undefined, 300, 1000).state;
    const result = settleMembrane(pulled, 1000 + RELEASE_AFTER_MS - 1);
    expect(result.state).toEqual(pulled);
    expect(result.action).toBe("none");
  });

  it("decays a held pull after release, without releasing a committed graph early", () => {
    const pulled = push(undefined, 300, 1000).state;
    const result = settleMembrane(pulled, 1000 + RELEASE_AFTER_MS + 1);
    expect(result.state.pull).toBeLessThan(pulled.pull);
    expect(result.action).toBe("none");
  });

  it("releases a committed graph once the pull decays under the return threshold", () => {
    const committed = pushToCommit();
    const settled = settleMembrane(committed.state, committed.now + 4000);
    expect(settled.action).toBe("release");
    expect(settled.state.committed).toBe(false);
    expect(settled.state.pull).toBe(0);
  });

  it("releases a half pull that never committed", () => {
    const pulled = push(undefined, 200, 1000).state;
    const settled = settleMembrane(pulled, 1000 + 6000);
    expect(settled.state.pull).toBe(0);
    expect(settled.action).toBe("none");
  });

  it("is a no-op at rest and on a paused clock", () => {
    expect(settleMembrane(RESTING_MEMBRANE, 10)).toEqual({
      state: RESTING_MEMBRANE,
      action: "none",
      cameraShare: 1,
    });
    const pulled = push(undefined, 300, 1000).state;
    const paused = settleMembrane(pulled, Number.NEGATIVE_INFINITY);
    expect(paused.state).toEqual(pulled);
  });
});
