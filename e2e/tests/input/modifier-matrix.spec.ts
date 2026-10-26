import { expect, type Locator, type Page, test } from "@playwright/test";
import { cards, workspaceIdFactory } from "../fixtures/support";

const id = workspaceIdFactory("e2e-modifier-matrix");
const workspaceUrl = (name: string) => `/?workspace=${id(name)}`;

const linkMode = (page: Page) => page.getByTestId("link-mode-toggle");
const purpose = (page: Page) => page.getByTestId("purpose-toggle");

/** The four modes, in family order. */
const MODES = ["place", "thread", "fan", "branch"] as const;
/** The four purposes a reader can hold, in family order. */
const PURPOSES = ["explore", "run", "record", "explain"] as const;

/** What each value draws, so a chip showing fan's glyph in branch's colour is caught. */
const GLYPH: Record<string, string> = {
  place: "\u2194",
  thread: "\u2933",
  fan: "\u273b",
  branch: "\u22d4",
  explore: "\u25cb",
  run: "\u2261",
  record: "\u25cf",
  explain: "\u25c8",
};

/** What a chip is painting, as the browser resolves it. */
interface Paint {
  glyph: string;
  background: string;
  ink: string;
}

async function paintOf(chip: Locator): Promise<Paint> {
  return chip.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      glyph: (node.textContent ?? "").trim(),
      background: style.backgroundColor,
      ink: style.color,
    };
  });
}

const KEY = {
  shift: { name: "shift", keys: ["Shift"] },
  ctrl: { name: "ctrl", keys: ["Control"] },
  alt: { name: "alt", keys: ["Alt"] },
} as const;

/**
 * The modifier map as a matrix (ADR-0066).
 *
 * The property under test is not "this key shows this mode" — that is a table the
 * implementation could restate. It is that **whatever is stored, the bar shows the
 * stored value plus the three keys and between them they name every value exactly
 * once**. A step-back rule satisfied the hand-written cases and still failed this:
 * from `fan`, shift and ctrl both showed `thread` and `place` was unreachable.
 *
 * Run mode moves focus into the library's search field, and typing suppresses the
 * modifiers (a held shift is a capital letter, not a gesture), so the canvas is clicked
 * after every stored value is chosen — which is also what a reader does next.
 */
async function defocus(page: Page): Promise<void> {
  await page.mouse.click(760, 90);
}

async function hold(page: Page, keys: readonly string[]): Promise<void> {
  for (const key of keys) await page.keyboard.down(key);
  // A held key paints synchronously, but the label is written in a layout effect.
  await expect(page.locator("body")).toBeVisible();
}

async function release(page: Page, keys: readonly string[]): Promise<void> {
  for (const key of [...keys].reverse()) await page.keyboard.up(key);
}

/**
 * Click a chip until it holds `value`.
 *
 * Absolute rather than "click n times": the control is a cycle, so a relative count
 * depends on where the previous cell of the matrix left it, and a single click that
 * does not land would silently shift every later assertion by one.
 */
async function walkTo(chip: Locator, attribute: string, value: string): Promise<void> {
  for (let step = 0; step < 8; step += 1) {
    if ((await chip.getAttribute(attribute)) === value) return;
    await chip.click();
  }
  throw new Error(`could not reach ${attribute}=${value}`);
}

/** Put the app in a theme, because the palette resolves per theme. */
async function useTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.getByTestId("theme-toggle").click();
  await page.getByTestId(`theme-${theme}`).click();
  await expect(page.getByTestId("theme-toggle")).toHaveAttribute("data-mode", theme);
}

/** What each mode paints like when it is the stored one: the reference for previews. */
async function committedModes(page: Page): Promise<Map<string, Paint>> {
  const paints = new Map<string, Paint>();
  for (const [index, mode] of MODES.entries()) {
    if (index > 0) await linkMode(page).click();
    await defocus(page);
    await expect(linkMode(page)).toHaveAttribute("data-mode", mode);
    paints.set(mode, await paintOf(linkMode(page)));
  }
  // One more click closes the cycle, back to `place`.
  await linkMode(page).click();
  await expect(linkMode(page)).toHaveAttribute("data-mode", "place");
  return paints;
}

/** The same for the purposes a reader can hold, plus `explain`'s reserved colour. */
async function committedPurposes(page: Page): Promise<Map<string, Paint>> {
  const paints = new Map<string, Paint>();
  for (const [index, stored] of PURPOSES.entries()) {
    if (index > 0) await purpose(page).click();
    await defocus(page);
    await expect(purpose(page)).toHaveAttribute("data-purpose", stored);
    paints.set(stored, await paintOf(purpose(page)));
  }
  // One more click closes the cycle, back to `explore`.
  await purpose(page).click();
  await expect(purpose(page)).toHaveAttribute("data-purpose", "explore");
  return paints;
}

for (const theme of ["light", "dark"] as const) {
  test(`[${theme}] the mode axis closes over all four modes from any stored mode`, async ({
    page,
  }) => {
    await page.goto(workspaceUrl(`modes-${theme}`));
    await expect(cards(page)).toHaveCount(2);
    await useTheme(page, theme);
    const paint = await committedModes(page);

    for (const stored of MODES) {
      await walkTo(linkMode(page), "data-mode", stored);
      await defocus(page);

      const shown: (string | null)[] = [stored];
      for (const key of Object.values(KEY)) {
        await hold(page, key.keys);
        const previewed = await linkMode(page).getAttribute("data-preview");
        // The preview is painted from the attribute, not by adding a class: previewing
        // `place` from `thread` has to *remove* the stored look, not stack on it.
        expect(previewed, `${stored} + ${key.name}`).not.toBeNull();
        expect(previewed, `${stored} + ${key.name}`).not.toBe(stored);
        shown.push(previewed);

        // The glyph and the fill are the proposed mode's, not the stored one's:
        // `branch` + ctrl drawing fan's glyph in branch's green is what this catches.
        const held = await paintOf(linkMode(page));
        expect(held.glyph, `${stored} + ${key.name} glyph`).toBe(GLYPH[previewed ?? ""]);
        expect(held.background, `${stored} + ${key.name} fill`).toBe(
          paint.get(previewed ?? "")?.background,
        );
        expect(held.ink, `${stored} + ${key.name} ink`).toBe(paint.get(previewed ?? "")?.ink);

        await release(page, key.keys);
        await expect(linkMode(page)).not.toHaveAttribute("data-preview");
        // Released, the chip is back to painting the stored mode exactly.
        const after = await paintOf(linkMode(page));
        expect(after.background, `${stored} after release`).toBe(paint.get(stored)?.background);
      }

      expect(new Set(shown).size, `${stored}: ${shown.join(", ")}`).toBe(MODES.length);
      expect([...shown].sort(), `${stored}: ${shown.join(", ")}`).toEqual([...MODES].sort());
    }
  });

  test(`[${theme}] the purpose axis closes over all four purposes, explain included`, async ({
    page,
  }) => {
    await page.goto(workspaceUrl(`purpose-${theme}`));
    await expect(cards(page)).toHaveCount(2);
    await useTheme(page, theme);
    const paint = await committedPurposes(page);

    for (const stored of PURPOSES) {
      await walkTo(purpose(page), "data-purpose", stored);
      await defocus(page);

      const shown: (string | null)[] = [stored];
      for (const key of Object.values(KEY)) {
        await hold(page, key.keys);
        const previewed = await purpose(page).getAttribute("data-preview");
        expect(previewed, `${stored} + ${key.name}`).not.toBeNull();
        expect(previewed, `${stored} + ${key.name}`).not.toBe(stored);
        shown.push(previewed);

        const held = await paintOf(purpose(page));
        expect(held.glyph, `${stored} + ${key.name} glyph`).toBe(GLYPH[previewed ?? ""]);
        expect(held.background, `${stored} + ${key.name} fill`).toBe(
          paint.get(previewed ?? "")?.background,
        );

        await release(page, key.keys);
        await expect(purpose(page)).not.toHaveAttribute("data-preview");
        const after = await paintOf(purpose(page));
        expect(after.background, `${stored} after release`).toBe(paint.get(stored)?.background);
      }

      expect(new Set(shown).size, `${stored}: ${shown.join(", ")}`).toBe(PURPOSES.length);
      expect([...shown].sort(), `${stored}: ${shown.join(", ")}`).toEqual([...PURPOSES].sort());
    }
  });
}

/**
 * The case the author reported: the second value in both families, where a step-back
 * rule made shift and ctrl agree and left connect mode unreachable from the bar.
 */
test("from fan, the keys name thread, connect and branch — one each", async ({ page }) => {
  await page.goto(workspaceUrl("fan"));
  await expect(cards(page)).toHaveCount(2);

  await linkMode(page).click();
  await linkMode(page).click();
  await expect(linkMode(page)).toHaveAttribute("data-mode", "fan");
  await defocus(page);

  await hold(page, KEY.shift.keys);
  await expect(linkMode(page)).toHaveAttribute("data-preview", "thread");
  await release(page, KEY.shift.keys);

  await hold(page, KEY.ctrl.keys);
  await expect(linkMode(page)).toHaveAttribute("data-preview", "place");
  await release(page, KEY.ctrl.keys);

  await hold(page, KEY.alt.keys);
  await expect(linkMode(page)).toHaveAttribute("data-preview", "branch");
  await release(page, KEY.alt.keys);

  // Releasing always lands back on the stored mode, never on a preview.
  await expect(linkMode(page)).toHaveAttribute("data-mode", "fan");
  await expect(linkMode(page)).not.toHaveAttribute("data-preview");
});
