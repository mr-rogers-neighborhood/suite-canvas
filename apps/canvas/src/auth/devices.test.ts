import { describe, expect, it } from "vitest";
import { deviceLabel } from "./devices";

/**
 * The label is a shortcut for a reader, not a fingerprint. Unknown agents are
 * named honestly rather than guessed at.
 */
describe("device labels", () => {
  it("names a browser and a system when the agent says so", () => {
    expect(
      deviceLabel(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      ),
    ).toBe("Chrome on macOS");
    expect(
      deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/120.0"),
    ).toBe("Edge on Windows");
    expect(
      deviceLabel("Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0"),
    ).toBe("Firefox on Linux");
  });

  it("falls back to whichever half it knows", () => {
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14)")).toBe("A browser on Android");
    expect(deviceLabel("Mozilla/5.0 Chrome/120.0")).toBe("Chrome");
  });

  it("says 'a browser' rather than inventing a name", () => {
    expect(deviceLabel(null)).toBe("A browser");
    expect(deviceLabel("   ")).toBe("A browser");
    expect(deviceLabel("curl/8.4.0")).toBe("A browser");
  });
});
