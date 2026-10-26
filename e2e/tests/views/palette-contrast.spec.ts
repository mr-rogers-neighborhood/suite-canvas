import { expect, test } from "@playwright/test";
import { withOwnerKey } from "../fixtures/ownerUrl";
import { cards, workspaceIdFactory } from "../fixtures/support";

const id = workspaceIdFactory("e2e-palette-contrast");

/**
 * The palette's accessibility floor ([ADR-0064](../../docs/decisions/0064-two-axes-and-a-cursor-that-says-so.md)
 * fifth amendment).
 *
 * The values are resolved by the browser — `color-mix`, `var()` chains and a per-theme
 * block all sit between the token and the pixel — so a unit test reading hexes out of the
 * stylesheet would be testing something nobody sees. Each pair is measured from an element
 * that actually paints it, in both themes.
 *
 * 4.5:1 is the text floor and the target here: the glyphs are single characters that carry
 * meaning, and a reader who cannot see the star on the blue chip has lost the mode. The
 * measured numbers are printed on failure, so a palette change that breaks one says which.
 */

/** Everything a "value" is called, across both axes. */
const VALUES = ["place", "thread", "fan", "branch", "explore", "run", "record", "explain"] as const;

const FLOOR = 4.5;

type Rgb = [number, number, number];

/** Parse what Chromium actually returns: `rgb()`, `rgba()` or `color(srgb …)`. */
function parseColour(value: string): Rgb | null {
  const rgb = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];

  // color-mix() resolves to `color(srgb r g b)` with 0..1 channels.
  const srgb = value.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (srgb) {
    return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255];
  }
  return null;
}

function luminance([red, green, blue]: Rgb): number {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function contrast(background: string, ink: string): number | null {
  const back = parseColour(background);
  const front = parseColour(ink);
  if (!back || !front) return null;
  const [high, low] = [luminance(back), luminance(front)].sort((a, b) => b - a) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: every value clears 4.5:1 for its glyph on its fill`, async ({ page }) => {
    await page.goto(withOwnerKey(`/?workspace=${id(theme)}`));
    await expect(cards(page)).toHaveCount(2);
    await page.getByTestId("theme-toggle").click();
    await page.getByTestId(`theme-${theme}`).click();
    await expect(page.getByTestId("theme-toggle")).toHaveAttribute("data-mode", theme);

    const measured = await page.evaluate((values) => {
      const probe = document.createElement("div");
      document.body.append(probe);
      const read = (name: string) => {
        probe.style.background = "";
        probe.style.color = "";
        probe.style.background = `var(--value-${name}-fill)`;
        probe.style.color = `var(--value-${name}-ink)`;
        const style = getComputedStyle(probe);
        return { background: style.backgroundColor, ink: style.color };
      };
      const result = Object.fromEntries(values.map((value) => [value, read(value)]));
      probe.remove();
      return result;
    }, VALUES);

    const failures: string[] = [];
    for (const value of VALUES) {
      const pair = measured[value];
      const ratio = contrast(pair.background, pair.ink);
      // A pair that cannot be parsed is a failure too: it means a token resolved to
      // something a browser cannot paint, which is worse than a low ratio.
      if (ratio === null) {
        failures.push(`${value}: unparseable (${pair.background} / ${pair.ink})`);
        continue;
      }
      if (ratio < FLOOR) {
        failures.push(`${value}: ${ratio.toFixed(2)}:1 (${pair.ink} on ${pair.background})`);
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
  });
}
