import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { pointerOwnedByRun, usePlacementRunStore } from "../placementRun";
import { useSettledRun } from "./useSettledRun";

/**
 * The last card of a run, and the rest of the press that placed it.
 *
 * The run used to disappear inside the `pointerdown` that placed its final card, so
 * the connection events React Flow fires before the pointer comes up saw no run and
 * drew a link nobody asked for. The latch is what makes the guard last exactly as long
 * as the gesture does.
 */

afterEach(() => {
  usePlacementRunStore.setState({ run: null, proposal: null, suspended: [], settling: false });
});

describe("a run that has placed its last card", () => {
  it("should still own the pointer until it is released", () => {
    renderHook(() => useSettledRun());
    act(() => usePlacementRunStore.setState({ settling: true }));

    expect(pointerOwnedByRun()).toBe(true);
  });

  it("should let go on the pointerup that ends the gesture", () => {
    renderHook(() => useSettledRun());
    act(() => usePlacementRunStore.setState({ settling: true }));

    act(() => {
      window.dispatchEvent(new Event("pointerup"));
    });

    expect(pointerOwnedByRun()).toBe(false);
  });

  it("should let go when the gesture is cancelled, which never sees its own up", () => {
    renderHook(() => useSettledRun());
    act(() => usePlacementRunStore.setState({ settling: true }));

    act(() => {
      window.dispatchEvent(new Event("pointercancel"));
    });

    expect(pointerOwnedByRun()).toBe(false);
  });

  it("should not listen when nothing is settling", () => {
    renderHook(() => useSettledRun());

    act(() => {
      window.dispatchEvent(new Event("pointerup"));
    });

    expect(pointerOwnedByRun()).toBe(false);
  });
});
