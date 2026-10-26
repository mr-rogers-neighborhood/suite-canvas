import { expect, test } from "@playwright/test";
import { withOwnerKey } from "../fixtures/ownerUrl";
import { cards, workspaceIdFactory } from "../fixtures/support";

const id = workspaceIdFactory("e2e-viewport-pill");

/**
 * The pill at the bottom-left, in one piece (ADR-0071).
 *
 * Six controls sit there and only three of them are ours, so the pieces used to be three
 * containers: React Flow's own stack, the link tool's button, and the purpose button, each
 * with its own border, radius and padding. The result was a 1.33px width step down the
 * middle of a control the reader reads as one thing. Now React Flow's container owns the
 * box and every segment is a 26px cell inside it, which is a claim about the rendered page:
 * the geometry has to be measured, not read out of the stylesheet.
 */

/** The three numbers the pill is built from. */
const CELL = 26;
const BORDER = 1;
const RADIUS = 12;

type Box = { x: number; y: number; width: number; height: number };

async function pillBox(page: import("@playwright/test").Page): Promise<Box> {
  const box = await page.locator(".react-flow__controls").boundingBox();
  if (!box) throw new Error("the pill is not on screen");
  return box;
}

/** The container's children, measured, with the background each one actually paints. */
async function segments(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const pill = document.querySelector(".react-flow__controls") as HTMLElement;
    return [...pill.children].map((child) => {
      const box = child.getBoundingClientRect();
      const style = getComputedStyle(child as HTMLElement);
      return {
        className: (child as HTMLElement).className,
        x: box.x,
        width: box.width,
        height: box.height,
        radius: style.borderTopLeftRadius,
        shadow: style.boxShadow,
        border: style.borderTopWidth,
        background: style.backgroundColor,
      };
    });
  });
}

test("the pill is one box with uniform cells", async ({ page }) => {
  await page.goto(withOwnerKey(`/?workspace=${id("pill-one-owner")}`));
  await expect(cards(page).first()).toBeVisible();

  const cells = await segments(page);
  expect(cells).toHaveLength(5);

  const [first] = cells;
  if (!first) throw new Error("the pill has no segments");
  const left = first.x;
  for (const cell of cells) {
    expect(cell.x).toBeCloseTo(left, 1);
    expect(cell.width).toBeCloseTo(CELL, 1);
    expect(cell.height).toBeCloseTo(CELL, 1);
    // The container draws the box: no cell repeats its border, radius or shadow.
    expect(cell.border).toBe("0px");
    expect(cell.radius).toBe("0px");
    expect(cell.shadow).toBe("none");
  }

  const container = await page.evaluate(() => {
    const style = getComputedStyle(document.querySelector(".react-flow__controls") as HTMLElement);
    return { radius: style.borderTopLeftRadius, shadow: style.boxShadow };
  });
  expect(container.radius).toBe(`${RADIUS}px`);
  expect(container.shadow).not.toBe("none");

  const box = await pillBox(page);
  expect(box.width).toBeCloseTo(CELL + BORDER * 2, 1);
  expect(box.height).toBeCloseTo(CELL * cells.length + BORDER * 2, 1);
});

test("a value fills its cell edge to edge, in both themes", async ({ page }) => {
  await page.goto(withOwnerKey(`/?workspace=${id("pill-fills")}`));
  await expect(cards(page).first()).toBeVisible();

  for (const theme of ["light", "dark"] as const) {
    await page.getByTestId("theme-toggle").click();
    await page.getByTestId(theme === "light" ? "theme-light" : "theme-dark").click();

    const box = await pillBox(page);
    const mode = page.getByTestId("link-mode-toggle");
    const purpose = page.getByTestId("purpose-toggle");

    for (const [control, attribute, resting] of [
      [mode, "data-mode", "connect"],
      [purpose, "data-purpose", "explore"],
    ] as const) {
      const seen = new Map<string, string>();
      // Walk the whole cycle and stop when it comes back around, so this keeps working
      // if a value is added or reordered.
      for (let step = 0; step < 6; step += 1) {
        const state = await control.getAttribute(attribute);
        const paint = await control.evaluate((el) => {
          const style = getComputedStyle(el as HTMLElement);
          const rect = (el as HTMLElement).getBoundingClientRect();
          return {
            background: style.backgroundColor,
            left: rect.left,
            width: rect.width,
          };
        });
        if (state) {
          if (seen.has(state)) break;
          seen.set(state, paint.background);
          if (state !== resting) {
            // Every value but the resting one paints a fill, and the fill spans the cell:
            // a coloured block inset by its own padding reads as a chip floating in the
            // pill rather than as the pill's current state.
            expect(paint.background).not.toBe(seen.get(resting) ?? "unset");
          }
          expect(paint.left).toBeCloseTo(box.x + BORDER, 1);
          expect(paint.width).toBeCloseTo(box.width - BORDER * 2, 1);
        }
        await control.click();
      }
      expect(seen.size).toBeGreaterThan(1);
    }
  }
});

test("a run's bar is its own panel above the pill", async ({ page }) => {
  await page.goto(withOwnerKey(`/?workspace=${id("pill-run-bar")}`));
  await expect(cards(page).first()).toBeVisible();

  await page.getByTestId("dock-library").click();
  await page.getByTestId("library-tab-cards").click();
  await page.getByTestId("library-select-toggle").click();
  await page.getByTestId("library-selection-all").click();
  await page.getByTestId("library-run-thread").click();
  const bar = page.getByTestId("placement-run");
  await expect(bar).toBeVisible();

  // The link tool's segment withdraws for the duration, so the bar has to carry the
  // value: the same glyph, painted from the same tokens.
  await expect(bar).toHaveAttribute("aria-label", "Thread mode run");
  const chip = await bar.locator(".placement-run__mode").evaluate((el) => {
    const style = getComputedStyle(el as HTMLElement);
    return { background: style.backgroundColor, color: style.color };
  });
  expect(chip.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(chip.color).not.toBe(chip.background);

  const geometry = await page.evaluate(() => {
    const bar = document.querySelector(".placement-run") as HTMLElement;
    const pill = document.querySelector(".react-flow__controls") as HTMLElement;
    const barBox = bar.getBoundingClientRect();
    const pillBox = pill.getBoundingClientRect();
    return {
      gap: pillBox.top - barBox.bottom,
      left: barBox.left,
      pillLeft: pillBox.left,
      insidePill: pill.contains(bar),
    };
  });

  // A run bar nested in the pill would be a sixth cell in a box that is about tools; it
  // is a small panel of its own, made to look like one.
  expect(geometry.insidePill).toBe(false);
  expect(geometry.gap).toBeCloseTo(8, 1);
  expect(geometry.left).toBeCloseTo(geometry.pillLeft, 1);
});
