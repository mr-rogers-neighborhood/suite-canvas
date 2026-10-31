import { beforeEach, describe, expect, it } from "vitest";
import { PROJECTION_KEY, useProjectionStore } from "./projectionStore";

const STORAGE_KEY = "suite.projection.v1";

function stored(): Record<string, { viewId: string; fade: boolean; outline: boolean }> {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
}

beforeEach(() => {
  window.localStorage.clear();
  useProjectionStore.setState({ byWorkspace: {} });
});

describe("the projection store", () => {
  it("should default to fading and outlining, which is what a projection is for", () => {
    useProjectionStore.getState().project("view-1");
    expect(useProjectionStore.getState().byWorkspace[PROJECTION_KEY]).toEqual({
      viewId: "view-1",
      fade: true,
      outline: true,
    });
  });

  it("should remember the reader's switches when they project another view", () => {
    useProjectionStore.getState().project("view-1");
    useProjectionStore.getState().setToggles({ fade: false });

    // The switch describes how this reader likes to read, so it outlives the view it was set in.
    useProjectionStore.getState().project("view-2");
    expect(useProjectionStore.getState().byWorkspace[PROJECTION_KEY]).toEqual({
      viewId: "view-2",
      fade: false,
      outline: true,
    });
  });

  it("should ignore a switch with nothing projected, because there is nothing to read", () => {
    useProjectionStore.getState().setToggles({ fade: false });
    expect(useProjectionStore.getState().byWorkspace[PROJECTION_KEY]).toBeUndefined();
  });

  it("should write the projection to storage so a reload returns to it", () => {
    useProjectionStore.getState().project("view-1");
    expect(stored()[PROJECTION_KEY]?.viewId).toBe("view-1");
  });

  it("should stop projecting on request", () => {
    useProjectionStore.getState().project("view-1");
    useProjectionStore.getState().stop();
    expect(useProjectionStore.getState().byWorkspace[PROJECTION_KEY]).toBeUndefined();
    expect(stored()[PROJECTION_KEY]).toBeUndefined();
  });

  it("should forget a view that was deleted, and only that one", () => {
    useProjectionStore.getState().project("view-1");
    useProjectionStore.getState().forget("view-2");
    expect(useProjectionStore.getState().byWorkspace[PROJECTION_KEY]?.viewId).toBe("view-1");

    useProjectionStore.getState().forget("view-1");
    expect(useProjectionStore.getState().byWorkspace[PROJECTION_KEY]).toBeUndefined();
  });

  it("should survive storage it cannot read rather than throwing on boot", () => {
    window.localStorage.setItem(STORAGE_KEY, "not json");
    // The store reads lazily on hydration; an unreadable record is no record.
    expect(() => useProjectionStore.getState().project("view-1")).not.toThrow();
    expect(useProjectionStore.getState().byWorkspace[PROJECTION_KEY]?.viewId).toBe("view-1");
  });
});
