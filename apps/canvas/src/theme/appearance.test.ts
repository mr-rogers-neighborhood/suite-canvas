import { describe, expect, it } from "vitest";
import {
  APPEARANCE_STORAGE_KEY,
  applyAppearance,
  DEFAULT_APPEARANCE,
  readStoredAppearance,
} from "./appearance";

/** A storage stub: the reader's preferences live in local storage, not in the document. */
function storage(entries: Record<string, string>) {
  return {
    getItem: (key: string) => entries[key] ?? null,
  };
}

describe("appearance preferences", () => {
  it("starts from the defaults when nothing is stored", () => {
    expect(readStoredAppearance(storage({}))).toEqual(DEFAULT_APPEARANCE);
  });

  it("keeps what the reader chose", () => {
    const stored = readStoredAppearance(
      storage({
        [APPEARANCE_STORAGE_KEY]: JSON.stringify({
          density: "compact",
          radius: 4,
          canvasBackground: "plain",
          motion: "reduced",
        }),
      }),
    );

    expect(stored).toEqual({
      density: "compact",
      radius: 4,
      canvasBackground: "plain",
      motion: "reduced",
    });
  });

  it("survives a hand-edited record one field at a time", () => {
    // A build that once lacked `motion`, or a value someone typed by hand, must not cost
    // the reader the preferences that are still valid.
    const stored = readStoredAppearance(
      storage({
        [APPEARANCE_STORAGE_KEY]: JSON.stringify({ density: "compact", motion: "sideways" }),
      }),
    );

    expect(stored.density).toBe("compact");
    expect(stored.motion).toBe(DEFAULT_APPEARANCE.motion);
    expect(stored.radius).toBe(DEFAULT_APPEARANCE.radius);
  });

  it("clamps a radius outside the control's range instead of trusting it", () => {
    const stored = readStoredAppearance(
      storage({ [APPEARANCE_STORAGE_KEY]: JSON.stringify({ radius: 5000 }) }),
    );

    expect(stored.radius).toBe(28);
  });

  it("falls back rather than failing boot on a corrupt value", () => {
    expect(readStoredAppearance(storage({ [APPEARANCE_STORAGE_KEY]: "{not json" }))).toEqual(
      DEFAULT_APPEARANCE,
    );
    expect(readStoredAppearance(storage({ [APPEARANCE_STORAGE_KEY]: "null" }))).toEqual(
      DEFAULT_APPEARANCE,
    );
  });

  it("paints the preferences onto the root as attributes, so the stylesheet decides", () => {
    const root = document.createElement("html");

    applyAppearance(
      { density: "compact", radius: 6, canvasBackground: "plain", motion: "reduced" },
      root,
    );

    // Attributes rather than inline styles: a test can assert the decision reached the
    // root without measuring pixels, and the CSS keeps the meaning.
    expect(root.dataset.density).toBe("compact");
    expect(root.dataset.canvas).toBe("plain");
    expect(root.dataset.motion).toBe("reduced");
    expect(root.style.getPropertyValue("--reader-card-radius")).toBe("6px");
  });
});
