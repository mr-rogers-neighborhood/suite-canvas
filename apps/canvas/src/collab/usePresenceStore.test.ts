import { EphemeralStore } from "loro-crdt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
});
