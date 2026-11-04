import { describe, expect, it } from "vitest";
import { DESKTOP_BRIDGE_KEY, desktopBridge, hostKind } from "./bridge";

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
