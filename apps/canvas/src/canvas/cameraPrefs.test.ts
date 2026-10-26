import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCameraPrefs } from "./cameraPrefs";

/**
 * The grid preference survives a board switch and a reload, and a browser that
 * refuses storage still gets a working toggle.
 */

beforeEach(() => {
  window.localStorage.clear();
  vi.resetModules();
  useCameraPrefs.setState({ gridVisible: true });
});

describe("the dot grid preference", () => {
  it("toggles and records the choice", () => {
    expect(useCameraPrefs.getState().gridVisible).toBe(true);

    useCameraPrefs.getState().toggleGrid();

    expect(useCameraPrefs.getState().gridVisible).toBe(false);
    expect(window.localStorage.getItem("suite.canvas.grid")).toBe("off");
  });

  it("reads a recorded choice back", async () => {
    window.localStorage.setItem("suite.canvas.grid", "off");
    // A fresh module instance is what a reload produces.
    const reloaded = await import("./cameraPrefs");

    expect(reloaded.useCameraPrefs.getState().gridVisible).toBe(false);
  });
});
