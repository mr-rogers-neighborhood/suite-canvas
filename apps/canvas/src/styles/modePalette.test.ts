import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The value palette ([ADR-0064](../../../docs/decisions/0064-two-axes-and-a-cursor-that-says-so.md)
 * fifth amendment).
 *
 * The rule is one palette, eight values, named by role. Three things can silently rot
 * it, so all three are asserted against the stylesheets themselves:
 *
 * - a component naming a colour instead of a role, which is how two surfaces drift;
 * - a value losing one of its three tokens, which paints half a control;
 * - a retired token (`--state-*`) surviving in a file that still reads it.
 */

/**
 * Read a sibling stylesheet.
 *
 * Deliberately not `new URL(..., import.meta.url)`: under Vitest's transform that URL
 * is virtual and resolves back to this file, which would make every assertion below
 * read the test instead of the CSS. The working directory is the one stable anchor, so
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

const global = read("global.css");
const purpose = read("purpose.css");
const cursor = read("cursor.css");

const VALUES = ["place", "thread", "fan", "branch", "explore", "run", "record", "explain"] as const;

describe("the value palette", () => {
  it("defines hue, fill and ink for every value", () => {
    for (const value of VALUES) {
      for (const part of ["hue", "fill", "ink"]) {
        expect(global).toContain(`--value-${value}-${part}:`);
      }
    }
  });

  it("maps every attribute a component can carry onto the palette", () => {
    // The mapping is what lets a component say `data-mode` and hold no colour.
    for (const value of ["place", "thread", "fan", "branch"]) {
      expect(global).toContain(`[data-mode="${value}"]`);
    }
    for (const value of ["explore", "run", "record", "explain"]) {
      expect(global).toContain(`[data-purpose="${value}"]`);
    }
  });

  it("gives present no hue of its own, because it is not one of the four choices", () => {
    const block = global.slice(global.indexOf('[data-purpose="present"]'));
    const rule = block.slice(0, block.indexOf("}"));
    // Its ring is the theme's ink; the ring's *shape* carries the state.
    expect(rule).toContain("--value-hue: var(--ink)");
    // A fifth hue here would imply a fifth mode.
    expect(rule).not.toMatch(/section-(blue|green|violet)/);
    expect(rule).not.toContain("--danger");
  });

  it("retires the state tokens from the files that used to read them", () => {
    for (const sheet of [purpose, cursor]) {
      expect(sheet).not.toMatch(/--state-(idle|active|recording|presenting)/);
    }
  });

  it("leaves no colour literal in the mode stylesheets except as a documented fallback", () => {
    for (const sheet of [purpose, cursor]) {
      // A hex in these files means a value that a theme cannot reach.
      expect(sheet).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
  });

  it("lets a held modifier paint the value it proposes", () => {
    // Preview and commit are the same painting: the preview wins over the stored value
    // by source order, and it reads the same tokens rather than its own colours.
    for (const value of ["explore", "run", "record", "explain"] as const) {
      expect(global).toContain(`[data-preview="${value}"]`);
    }
    // The tie-break block is last, so a preview cannot silently fail to paint.
    const last = global.lastIndexOf('[data-preview="run"]');
    expect(last).toBeGreaterThan(global.indexOf('[data-purpose="record"]'));
  });

  it("lets the resting value blend with the bar it sits in", () => {
    // The screenshots that prompted this: a filled resting value turned the bottom of
    // a dark pill into two white blocks. Resting is surface fill + ink glyph.
    for (const value of ["place", "explore"]) {
      expect(global).toContain(`--value-${value}-fill: var(--surface)`);
      expect(global).toContain(`--value-${value}-ink: var(--ink)`);
    }
    // And the second value is that pairing inverted, which is the "white" the author
    // sees in a dark theme and the "black" in a light one.
    for (const value of ["thread", "run"]) {
      expect(global).toContain(`--value-${value}-fill: var(--ink)`);
      expect(global).toContain(`--value-${value}-ink: var(--surface)`);
    }
  });

  it("paints the link control from the palette rather than from per-mode colours", () => {
    const start = global.indexOf(".link-mode-control {");
    const block = global.slice(start, start + 900);
    expect(block).toContain("background: var(--value-fill)");
    expect(block).toContain("color: var(--value-ink)");
  });
});
