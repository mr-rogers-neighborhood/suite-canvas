import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The value palette (ADR-0064
 * fifth amendment).
 *
 * The rule is one palette, eight values, named by role. Three things can silently rot
 * it, so all three are asserted against the stylesheets themselves:
 *
 * - a component naming a colour instead of a role, which is how two surfaces drift;
 * - a value losing one of its three tokens, which paints half a control;
 * - a retired token (`--state-*`) surviving in a file that still reads it, which is
 *   worse than it looks: an undefined custom property makes its whole declaration
 *   invalid at computed-value time, so `background: var(--gone)` is not "ignored" but
 *   *transparent*. That is how the purpose chip lost its fill on hover.
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

const VALUES = ["place", "thread", "fan", "branch", "explore", "record", "explain"] as const;

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
    // `run` is not a purpose: the placement run was removed, so no element carries it.
    for (const value of ["explore", "record", "explain", "present"]) {
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

  it("reads no custom property that nothing defines", () => {
    // The general form of the rule above, because `--purpose-state` was undefined and
    // the token check above did not know its name. Every `var(--x)` in a mode sheet
    // has to resolve to a declaration somewhere in the styles directory.
    const defined = new Set<string>();
    for (const name of [
      "global.css",
      "purpose.css",
      "cursor.css",
      "canvas.css",
      "editor.css",
      "library.css",
      "panels.css",
      "tour.css",
    ]) {
      let sheet: string;
      try {
        sheet = read(name);
      } catch {
        continue;
      }
      for (const match of sheet.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(match[1] as string);
    }

    for (const [name, sheet] of [
      ["purpose.css", purpose],
      ["cursor.css", cursor],
    ] as const) {
      const used = new Set(
        Array.from(sheet.matchAll(/var\((--[a-z0-9-]+)/g), (m) => m[1] as string),
      );
      const missing = [...used].filter((token) => !defined.has(token));
      expect(missing, `${name} reads ${missing.join(", ")}`).toEqual([]);
    }
  });

  it("leaves no colour literal in the mode stylesheets except as a documented fallback", () => {
    for (const sheet of [purpose, cursor]) {
      // A hex in these files means a value that a theme cannot reach.
      expect(sheet).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
  });

  it("maps a preview for every value, not only the ones that first had one", () => {
    // Previewing `place` from `thread` has to *remove* the stored mode's painting, and
    // `branch` + ctrl has to draw fan's blue rather than branch's green: both need a
    // mapping of their own.
    for (const value of VALUES) {
      expect(global).toContain(`[data-preview="${value}"]`);
    }
  });

  it("puts every preview below every committed rule, because the two collide", () => {
    /*
     * A control carries `data-mode` and `data-preview` on the same element, so the two
     * rule sets tie on specificity and source order decides. When a value's preview
     * shared a block with its committed form, the stored mode won wherever its block
     * came later — `branch` + ctrl painted fan's glyph in branch's green. This asserts
     * the ordering that makes the preview win by construction: no `[data-preview]`
     * selector may appear above any `[data-mode]` / `[data-purpose]` one.
     */
    const firstPreview = global.search(/\[data-preview="/);
    expect(firstPreview).toBeGreaterThan(-1);

    const committedAfter = [...global.matchAll(/\[data-(mode|purpose)="[a-z]+"\]/g)].filter(
      (match) => (match.index ?? 0) > firstPreview,
    );
    expect(
      committedAfter.map((match) => match[0]),
      "a committed selector sits below the preview block",
    ).toEqual([]);
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
    for (const value of ["thread"]) {
      expect(global).toContain(`--value-${value}-fill: var(--ink)`);
      expect(global).toContain(`--value-${value}-ink: var(--surface)`);
    }
  });

  it("paints the purpose segment from the palette rather than from per-mode colours", () => {
    // The rule lives in the pill's own block, where the container is the one owner: a
    // value is painted in one place, so a segment cannot disagree with the palette.
    const shared = [...global.matchAll(/\.react-flow__controls \.purpose-control\s*\{[^}]*}/g)].map(
      (match) => match[0],
    );
    expect(shared.length).toBeGreaterThanOrEqual(1);
    const block = shared.join("\n");
    expect(block).toContain("background: var(--value-fill)");
    expect(block).toContain("color: var(--value-ink)");

    // And the segment may not own a border again: that is what produced the seams.
    for (const segment of [".purpose-control {"]) {
      const at = segment.startsWith(".purpose")
        ? purpose.indexOf(segment)
        : global.indexOf(segment);
      const source = segment.startsWith(".purpose") ? purpose : global;
      const own = source.slice(at, source.indexOf("}", at));
      expect(own, segment).not.toContain("border:");
      expect(own, segment).not.toContain("box-shadow:");
      expect(own, segment).not.toContain("position: absolute");
    }
  });
});
