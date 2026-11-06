import { describe, expect, it } from "vitest";
import { DESKTOP_CSP, desktopCsp, resolveAppAsset, scriptSrcDirective } from "./protocol.js";

const ROOT = "/opt/suite/resources/renderer";

describe("resolveAppAsset", () => {
  it("serves the entry point for the bare origin", () => {
    expect(resolveAppAsset("app://canvas/", ROOT)).toEqual({
      ok: true,
      file: `${ROOT}/index.html`,
    });
  });

  it("serves an asset and keeps query routes out of the path", () => {
    expect(resolveAppAsset("app://canvas/index.html?workspace=ws_1", ROOT)).toEqual({
      ok: true,
      file: `${ROOT}/index.html`,
    });
    expect(resolveAppAsset("app://canvas/assets/main-abc.js", ROOT)).toEqual({
      ok: true,
      file: `${ROOT}/assets/main-abc.js`,
    });
  });

  it.each([
    "app://canvas/../../etc/passwd",
    "app://canvas/%2e%2e/%2e%2e/etc/passwd",
    "app://canvas/assets/../../../../etc/passwd",
  ])("refuses a climb in %s", (url) => {
    expect(resolveAppAsset(url, ROOT)).toEqual({ ok: false });
  });

  it("refuses another scheme", () => {
    expect(resolveAppAsset("https://evil.example/index.html", ROOT)).toEqual({ ok: false });
    expect(resolveAppAsset("file:///etc/passwd", ROOT)).toEqual({ ok: false });
  });

  it("refuses a path that resolves outside the root by prefix", () => {
    // `/opt/suite/resources/rendererevil` shares the prefix but is a different
    // directory, so the check has to be on a separator boundary.
    expect(resolveAppAsset("app://canvas/../rendererevil/x.js", ROOT)).toEqual({ ok: false });
  });
});

describe("desktopCsp", () => {
  it("is the shared policy with no dev exception", () => {
    expect(desktopCsp()).toBe(DESKTOP_CSP);
    expect(DESKTOP_CSP).toContain("connect-src 'self'");
  });
});

describe("DESKTOP_CSP", () => {
  it("allows WebAssembly, without which no document opens", () => {
    expect(DESKTOP_CSP).toContain("'wasm-unsafe-eval'");
  });

  it("never allows inline script", () => {
    // Style keeps `unsafe-inline` for the theme restored before first paint;
    // script must not, which is why the inline asset-path script became a file.
    const script = scriptSrcDirective();
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(script).toContain("'self'");
  });

  it("cannot reach the network from the renderer", () => {
    expect(DESKTOP_CSP).toContain("connect-src 'self'");
  });

  it("is default-deny", () => {
    expect(DESKTOP_CSP.startsWith("default-src 'none'")).toBe(true);
  });
});
