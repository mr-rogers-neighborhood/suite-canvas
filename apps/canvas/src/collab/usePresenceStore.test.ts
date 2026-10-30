import { EphemeralStore } from "loro-crdt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRESENCE_BEAT_MS } from "./peerProjection";
import { AWARENESS_FIELDS } from "./presence";
import { usePresenceStore } from "./usePresenceStore";

describe("usePresenceStore.bind", () => {
  beforeEach(() => {
    // The store polls on a 1 s interval; fake timers keep the test free of
    // open handles without changing the subscription behaviour under test.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should stop the previous store's subscription when it rebinds", () => {
    const bind = usePresenceStore.getState().bind;
    const first = new EphemeralStore(3000);
    const second = new EphemeralStore(3000);

    bind(first, "tab");
    bind(second, "tab");
    const peers = usePresenceStore.getState().peers;

    first.set("other", { name: "gone" });
    expect(usePresenceStore.getState().peers).toBe(peers);

    second.set("other", { name: "here" });
    expect(usePresenceStore.getState().peers).not.toBe(peers);
  });

  it("should beat on a timer, so silence means a peer left", () => {
    // Without this the relay has no way to distinguish a closed tab from a reader who is
    // simply not moving: it never announces a leave, so the other side expires on silence.
    const store = new EphemeralStore(60_000);
    usePresenceStore.getState().bind(store, "tab");

    const beatOf = (): unknown => {
      const state = store.get("tab");
      return typeof state === "object" && state !== null
        ? (state as Record<string, unknown>)[AWARENESS_FIELDS.presenceBeat]
        : undefined;
    };
    const before = beatOf();
    vi.advanceTimersByTime(PRESENCE_BEAT_MS * 2);
    const after = beatOf();

    expect(typeof after).toBe("number");
    expect(after).toBeGreaterThan(Number(before ?? 0));
  });

  it("should stop beating when the binding is replaced", () => {
    const first = new EphemeralStore(60_000);
    const second = new EphemeralStore(60_000);
    usePresenceStore.getState().bind(first, "tab");
    usePresenceStore.getState().bind(second, "tab");

    const beatOf = (): unknown => {
      const state = first.get("tab");
      return typeof state === "object" && state !== null
        ? (state as Record<string, unknown>)[AWARENESS_FIELDS.presenceBeat]
        : undefined;
    };
    const beats = beatOf();
    vi.advanceTimersByTime(PRESENCE_BEAT_MS * 3);
    // A leaked interval would keep publishing into a store nobody reads.
    expect(beatOf()).toBe(beats);
  });

  it("should delete the local peer from presence store on window pagehide/beforeunload", () => {
    const store = new EphemeralStore(60_000);
    usePresenceStore.getState().bind(store, "tab-unload");
    expect(store.get("tab-unload")).toBeDefined();

    window.dispatchEvent(new Event("beforeunload"));
    expect(store.get("tab-unload")).toBeUndefined();
  });
});
