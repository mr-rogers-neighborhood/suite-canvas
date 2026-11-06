import { describe, expect, it } from "vitest";
import { BUNDLED_ENTRY, devServerUrl, isRendererOrigin, rendererUrl } from "./rendererUrl.js";

const bundled = {};
const dev = { SUITE_DESKTOP_DEV_URL: "http://localhost:5173" };

describe("devServerUrl", () => {
  it("is null when nothing was configured", () => {
    expect(devServerUrl(bundled)).toBeNull();
    expect(devServerUrl({ SUITE_DESKTOP_DEV_URL: "  " })).toBeNull();
  });

  it("is the configured server", () => {
    expect(devServerUrl(dev)).toBe("http://localhost:5173");
  });
});

describe("rendererUrl", () => {
  it("loads the bundled entry point without a dev server", () => {
    expect(rendererUrl(bundled).toString()).toBe(BUNDLED_ENTRY);
  });

  it("loads the dev server's entry point when there is one", () => {
    expect(rendererUrl(dev).toString()).toBe("http://localhost:5173/index.html");
  });

  it("keeps a dev server's path prefix", () => {
    expect(rendererUrl({ SUITE_DESKTOP_DEV_URL: "http://localhost:5173/prefix" }).toString()).toBe(
      "http://localhost:5173/index.html",
    );
  });

  it("adds no sync parameters, because the transport is not the renderer's", () => {
    const url = rendererUrl({
      ...dev,
      SUITE_SYNC_URL: "ws://127.0.0.1:8787/sync",
      SUITE_SYNC_MEMBER: "a".repeat(64),
      SUITE_SYNC_WORKSPACE: "b".repeat(64),
      SUITE_SYNC_EPOCH: "2",
      SUITE_SYNC_DEVICE: "c".repeat(64),
    });

    expect(url.searchParams.get("syncUrl")).toBeNull();
    expect(url.searchParams.get("member")).toBeNull();
    expect(url.toString()).toBe("http://localhost:5173/index.html");
  });
});

describe("isRendererOrigin", () => {
  it("allows the bundled origin only, when there is no dev server", () => {
    expect(isRendererOrigin("app://canvas/index.html?workspace=ws_1", bundled)).toBe(true);
    expect(isRendererOrigin("app://canvas/", bundled)).toBe(true);
    expect(isRendererOrigin("http://localhost:5173/index.html", bundled)).toBe(false);
    expect(isRendererOrigin("https://evil.example/", bundled)).toBe(false);
  });

  it("allows the dev origin only, when there is one", () => {
    expect(isRendererOrigin("http://localhost:5173/index.html?workspace=ws_1", dev)).toBe(true);
    expect(isRendererOrigin("app://canvas/index.html", dev)).toBe(false);
  });

  it("refuses a URL that does not parse", () => {
    expect(isRendererOrigin("not a url", dev)).toBe(false);
  });
});
