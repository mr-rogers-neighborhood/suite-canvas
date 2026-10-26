import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Focus was drawn three ways — the accent, the ink and section blue — and four
 * surfaces had no rule at all, so they fell back to the user agent's ring.
 *
 * The stylesheet is the only place this can be checked: a component test cannot
 * see which colour a `:focus-visible` rule paints.
 */
const styles = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(styles, "global.css"), "utf8");

function rulesFor(file: string): string[] {
  return readFileSync(join(styles, file), "utf8").split("}");
}

describe("focus rings", () => {
  it("uses one token, never a literal", () => {
    for (const file of ["global.css", "outline.css", "cursor.css", "tour.css", "feedback.css"]) {
      const source = readFileSync(join(styles, file), "utf8");
      expect(source, file).not.toContain("outline: 2px solid #0a84ff");
      expect(source, file).not.toContain("outline: 2px solid var(--section-blue)");
      expect(source, file).not.toContain("outline: 2px solid var(--ink)");
    }
  });

  it("gives the surfaces that had none a ring", () => {
    for (const selector of [
      ".app-bar button:focus-visible",
      ".board-tabs button:focus-visible",
      ".dock-button:focus-visible",
      ".library-tab:focus-visible",
      ".library-row__open:focus-visible",
    ]) {
      expect(css, selector).toContain(selector);
    }
  });

  it("paints every ring with the accent token", () => {
    const rings = rulesFor("global.css").filter(
      (rule) => rule.includes(":focus-visible") && rule.includes("outline:"),
    );
    expect(rings.length).toBeGreaterThan(0);
    for (const rule of rings) {
      expect(rule, rule).toContain("outline: 2px solid var(--accent)");
    }
  });
});
