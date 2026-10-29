import { afterEach, describe, expect, it, vi } from "vitest";
import {
  alphaNoticeSeen,
  forgetAlphaNotice,
  REOPEN_AFTER_MS,
  rememberAlphaNotice,
} from "./alphaNotice";

/**
 * The rule the notice lives by while the product is alpha: a reader who dismissed it is not asked
 * again in the same sitting, and one who comes back later is. The window is the whole behaviour, so
 * it is checked at its edges rather than through the component, which only calls `alphaNoticeSeen`.
 */
const NOW = 1_760_000_000_000;

afterEach(() => {
  forgetAlphaNotice();
  vi.restoreAllMocks();
});

describe("the alpha notice's return", () => {
  it("shows for a browser that never dismissed it", () => {
    expect(alphaNoticeSeen(NOW)).toBe(false);
  });

  it("stays away immediately after a dismissal", () => {
    rememberAlphaNotice(NOW);
    expect(alphaNoticeSeen(NOW)).toBe(true);
  });

  it("stays away while the window is open, and returns one tick after it closes", () => {
    rememberAlphaNotice(NOW);
    // A second before the boundary is still the same visit; the boundary itself is not.
    expect(alphaNoticeSeen(NOW + REOPEN_AFTER_MS - 1)).toBe(true);
    expect(alphaNoticeSeen(NOW + REOPEN_AFTER_MS)).toBe(false);
  });

  it("returns the next day, which is the point of a timer rather than a flag", () => {
    rememberAlphaNotice(NOW);
    expect(alphaNoticeSeen(NOW + 24 * 60 * 60 * 1000)).toBe(false);
  });

  it("reads a clock that went backwards as recent rather than as ancient", () => {
    // A machine resuming from sleep, or somebody correcting the system clock, makes the
    // difference negative. The notice staying away until the clock settles is the quiet
    // failure; appearing on every navigation is the loud one.
    rememberAlphaNotice(NOW);
    expect(alphaNoticeSeen(NOW - 60_000)).toBe(true);
  });

  it("treats a stored value it cannot parse as never dismissed", () => {
    window.localStorage.setItem("suite.alpha-notice.v2", "seen");
    expect(alphaNoticeSeen(NOW)).toBe(false);
  });

  it("shows again on every visit when storage refuses to write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("the browser denied storage");
    });

    expect(() => rememberAlphaNotice(NOW)).not.toThrow();
    expect(alphaNoticeSeen(NOW)).toBe(false);
  });

  it("survives storage refusing to be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("the browser denied storage");
    });

    expect(alphaNoticeSeen(NOW)).toBe(false);
  });
});
