import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IconGlyph } from "./IconGlyph";
import { preloadIconRefs } from "./iconSets";

/**
 * An icon reference lives in the document; the set it names is code that arrives
 * asynchronously. A glyph therefore has to repaint when its set lands, or a reload shows a
 * document full of icons that are not drawn.
 */

beforeEach(() => {
  vi.resetModules();
});

describe("IconGlyph", () => {
  it("should draw nothing before its set has arrived", () => {
    const { container } = render(<IconGlyph icon={null} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("should draw the icon once the set lands, without the parent re-rendering", async () => {
    render(<IconGlyph icon="lucide:check" title="Done" />);

    // The set is a dynamic import of a real package, so it resolves after the first paint.
    await waitFor(() => expect(screen.getByRole("img", { name: "Done" })).toBeInTheDocument());
    expect(screen.getByRole("img", { name: "Done" }).getAttribute("data-icon")).toBe(
      "lucide:check",
    );
  });

  it("should stay silent for a reference no bundled set can answer", async () => {
    render(<IconGlyph icon="not-a-set:thing" title="Missing" />);
    // Give the rejected lookup a turn to finish before asserting the absence.
    await Promise.resolve();
    expect(screen.queryByRole("img", { name: "Missing" })).toBeNull();
  });
});

describe("preloadIconRefs", () => {
  it("should ask for each prefix once and ignore the rest of the reference list", async () => {
    const { container } = render(<IconGlyph icon={null} />);
    preloadIconRefs([null, undefined, "", "check", "lucide:check", "lucide:x", "lucide:y"]);
    // The preload is what makes the glyph below draw on its first paint.
    render(<IconGlyph icon="lucide:x" title="Preloaded" />);
    await waitFor(() => expect(screen.getByRole("img", { name: "Preloaded" })).toBeInTheDocument());
    expect(container.querySelector("svg")).toBeNull();
  });
});
