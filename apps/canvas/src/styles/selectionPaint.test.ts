import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * One selection, three kinds of thing.
 *
 * A card, a link and a section are each drawn by a different layer — a React Flow node, a React Flow
 * edge, a `ViewportPortal` div — so nothing in the code makes them share a look. That is exactly how
 * a marquee over links and sections came to look like it had selected nothing: the card ring was
 * never copied, and each layer's "selected" rule drifted to a thickness bump. These assertions pin
 * the accent to all three, so a restyle cannot quietly drop one again.
 */

function read(name: string): string {
  const candidates = [`apps/canvas/src/styles/${name}`, `src/styles/${name}`];
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {}
  }
  throw new Error(`could not read ${name} from ${process.cwd()}`);
}

const global = read("global.css");

/** The declarations of the first rule whose selector is exactly `selector`. */
function ruleFor(sheet: string, selector: string): string {
  const start = sheet.indexOf(`${selector} {`);
  expect(start, `${selector} has no rule`).toBeGreaterThan(-1);
  return sheet.slice(start, sheet.indexOf("}", start));
}

describe("the selection accent", () => {
  it("draws a selected card link in the accent, not only thicker", () => {
    const rule = ruleFor(global, ".react-flow__edge.selected .react-flow__edge-path");
    expect(rule).toContain("stroke: var(--accent)");
    expect(rule).toContain("stroke-width: 2.5");
  });

  it("draws a selected section link in the accent", () => {
    const rule = ruleFor(global, ".section-link.is-selected");
    expect(rule).toContain("stroke: var(--accent)");
  });

  /** The frame keeps its own colour in the border, so the selection has to be the ring. */
  it("rings a selected section in the accent without losing its colour", () => {
    const rule = ruleFor(global, ".section-region.is-selected");
    expect(rule).toContain("var(--accent)");
    expect(rule).toContain("box-shadow");
  });
});
