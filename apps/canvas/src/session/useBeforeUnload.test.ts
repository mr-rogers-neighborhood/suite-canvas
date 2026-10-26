import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBeforeUnload } from "./useBeforeUnload";

/**
 * The native tab-close prompt ([ADR-0025](../../../docs/decisions/0025-client-durability-and-offline-scope.md)
 * amendment).
 *
 * The listener is the whole feature: registered only while the rung is `banner`, gone the moment it
 * is not, and silent for a navigation the reader has already chosen.
 */

function asBeforeUnload(): BeforeUnloadEvent & Event {
  return new Event("beforeunload", { cancelable: true }) as unknown as BeforeUnloadEvent & Event;
}

describe("the native leave prompt", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is added while the work is at risk, and removed when it is not", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { rerender, unmount } = renderHook(({ active }) => useBeforeUnload(active), {
      initialProps: { active: true },
    });

    const [type, listener] = add.mock.calls.find(([name]) => name === "beforeunload") ?? [];
    expect(type).toBe("beforeunload");
    expect(listener).toBeTypeOf("function");

    // A re-render with the same state must not stack a second listener.
    rerender({ active: true });
    expect(add.mock.calls.filter(([name]) => name === "beforeunload")).toHaveLength(1);

    // The rung changed (signed in, or the browser granted durability): the prompt goes.
    rerender({ active: false });
    expect(remove).toHaveBeenCalledWith("beforeunload", listener);

    // Back at risk (a sign-out, or a new anonymous workspace): registered again.
    rerender({ active: true });
    expect(add.mock.calls.filter(([name]) => name === "beforeunload")).toHaveLength(2);

    unmount();
    expect(remove.mock.calls.filter(([name]) => name === "beforeunload")).toHaveLength(2);
  });

  it("asks the browser for its own dialog, and yields to a leave the reader chose", () => {
    const add = vi.spyOn(window, "addEventListener");
    let alreadyLeaving = false;
    const { rerender } = renderHook(() => useBeforeUnload(true, () => !alreadyLeaving));
    const handler = add.mock.calls.find(([name]) => name === "beforeunload")?.[1] as (
      event: BeforeUnloadEvent,
    ) => void;

    const atRisk = asBeforeUnload();
    handler(atRisk);
    expect(atRisk.defaultPrevented).toBe(true);

    // "Leave anyway" has already been answered in the app; the browser must not ask twice.
    alreadyLeaving = true;
    rerender();
    const chosenLeave = asBeforeUnload();
    handler(chosenLeave);
    expect(chosenLeave.defaultPrevented).toBe(false);
  });
});
