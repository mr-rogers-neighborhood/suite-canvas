import { describe, expect, it } from "vitest";
import {
  bridgeMissing,
  DESKTOP_BRIDGE_KEY,
  desktopBridge,
  hostKind,
  REQUIRED_BRIDGE_METHODS,
} from "./bridge";

/** A bridge publishing exactly the methods this build needs. */
function completeBridge(): Record<string, unknown> {
  return {
    host: "desktop",
    version: "0.1.0",
    platform: "linux",
    ...Object.fromEntries(REQUIRED_BRIDGE_METHODS.map((method) => [method, () => undefined])),
  };
}

describe("desktopBridge", () => {
  it("answers null in a browser", () => {
    expect(desktopBridge({})).toBeNull();
    expect(hostKind({})).toBe("web");
  });

  it("answers the bridge a preload exposes", () => {
    const scope = { [DESKTOP_BRIDGE_KEY]: { host: "desktop", version: "0.1.0" } };
    expect(desktopBridge(scope)).toEqual({ host: "desktop", version: "0.1.0" });
    expect(hostKind(scope)).toBe("desktop");
  });

  it.each([
    ["a string", "desktop"],
    ["a number", 1],
    ["null", null],
    ["an object with the wrong host", { host: "web", version: "0.1.0" }],
    ["an object with no version", { host: "desktop" }],
    ["an object with a non-string version", { host: "desktop", version: 3 }],
  ])("refuses %s, so a stray global cannot claim to be the shell", (_label, value) => {
    expect(desktopBridge({ [DESKTOP_BRIDGE_KEY]: value })).toBeNull();
    expect(hostKind({ [DESKTOP_BRIDGE_KEY]: value })).toBe("web");
  });
});

describe("bridgeMissing", () => {
  it("reports nothing for a shell that publishes every method this build calls", () => {
    const bridge = desktopBridge({ [DESKTOP_BRIDGE_KEY]: completeBridge() });
    expect(bridge).not.toBeNull();
    expect(bridgeMissing(bridge as NonNullable<typeof bridge>)).toEqual([]);
  });

  it("names the method an older shell does not publish", () => {
    const published = completeBridge();
    delete published.recentFiles;
    const bridge = desktopBridge({ [DESKTOP_BRIDGE_KEY]: published });
    expect(bridge).not.toBeNull();
    // The refusal is the point: without it, `recentFiles` is `undefined` and the
    // launcher does nothing when it is asked to list anything.
    expect(bridgeMissing(bridge as NonNullable<typeof bridge>)).toEqual(["recentFiles"]);
  });

  it("accepts the required list as a parameter, so a caller can narrow it", () => {
    const published = completeBridge();
    delete published.forgetRecent;
    const bridge = desktopBridge({ [DESKTOP_BRIDGE_KEY]: published });
    expect(bridgeMissing(bridge as NonNullable<typeof bridge>, ["recentFiles"])).toEqual([]);
  });

  it("treats a non-function value as missing", () => {
    const bridge = desktopBridge({
      [DESKTOP_BRIDGE_KEY]: { ...completeBridge(), recentFiles: "yes" },
    });
    expect(bridgeMissing(bridge as NonNullable<typeof bridge>)).toEqual(["recentFiles"]);
  });
});
