import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Read a sibling stylesheet. The working directory is the one stable anchor, so
 * both layouts (repo root, or the package directory) are tried.
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

const route = read("route.css");

/**
 * A dashed or dotted link marches forever. That is motion, so it needs the
 * reduced-motion block every other animated stylesheet already has: an OS-level
 * reduced-motion reader was still watching the dashes travel.
 */
describe("route reduced motion", () => {
  const block = (() => {
    const at = route.indexOf("@media (prefers-reduced-motion: reduce)");
    return at === -1 ? "" : route.slice(at);
  })();

  it("keeps a reduced-motion block for the animated link stroke", () => {
    expect(block).not.toBe("");
  });

  it("stops the dash on both link layers", () => {
    // The edge layer paints a link below the cards, the above-layer paints it
    // over them; both take the animation the painter sets inline.
    expect(block).toMatch(/\.route-edge \.react-flow__edge-path[\s\S]*?animation: none !important/);
    expect(block).toMatch(/\.above-link[\s\S]*?animation: none !important/);
  });
});
