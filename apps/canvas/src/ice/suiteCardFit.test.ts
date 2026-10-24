import { describe, expect, it } from "vitest";
import { cardFit, cardTextFit, wrappedLineCount } from "./suiteCardFit";
import { SUITE_TYPE_LADDER, scaleForExtent } from "./suiteCardScale";

const BOX = { width: 288, height: 240 };
const LONG = "Weekly review\n\nOpen every board, read what changed, then widen or prune.";
const SHORT = "Weekly review";

describe("wrappedLineCount", () => {
  it("should put a short line on one line", () => {
    expect(wrappedLineCount("Weekly review", 260, 13)).toBe(1);
  });

  it("should grow with the text", () => {
    const small = wrappedLineCount("one two three", 260, 13);
    const large = wrappedLineCount("one two three four five six seven eight nine ten", 160, 13);

    expect(large).toBeGreaterThan(small);
  });

  it("should count a blank line as a line, because a title sits above a body", () => {
    expect(wrappedLineCount("a\n\nb", 260, 13)).toBe(3);
  });

  it("should break a word longer than the line instead of overflowing", () => {
    const lines = wrappedLineCount("https://example.com/a/very/long/path/indeed", 80, 13);

    expect(lines).toBeGreaterThan(1);
  });

  it("should always answer at least one line for a non-empty string", () => {
    for (const width of [20, 60, 200, 900]) {
      expect(wrappedLineCount("x", width, 13)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("cardTextFit", () => {
  it("should need a taller box as the rung grows", () => {
    const atOne = cardTextFit(LONG, { width: 288, height: 4000 }, 1);
    const atTwo = cardTextFit(LONG, { width: 288, height: 4000 }, 2);

    expect(atTwo.height).toBeGreaterThan(atOne.height);
  });

  it("should report a box that is too short as not fitting", () => {
    expect(cardTextFit(LONG, { width: 288, height: 60 }, 2).fits).toBe(false);
  });

  it("should report a roomy box as fitting", () => {
    expect(cardTextFit(SHORT, { width: 288, height: 240 }, 1).fits).toBe(true);
  });

  it("should measure an empty card as needing nothing", () => {
    const fit = cardTextFit("", BOX, 1);

    expect(fit.lines).toBe(0);
    expect(fit.fits).toBe(true);
  });

  it("should treat a nonsense rung as the base one", () => {
    const fit = cardTextFit(SHORT, BOX, Number.NaN);

    expect(fit.lines).toBeGreaterThan(0);
    expect(Number.isFinite(fit.height)).toBe(true);
  });
});

describe("cardFit", () => {
  it("should step the rung down until the writing fits", () => {
    // The scrunched card from the screenshots: a body of text in a box whose
    // proportions ask for a big rung, but whose height cannot hold it.
    const extent = { width: 900, height: 300 };
    const fit = cardFit(LONG, extent);

    expect(fit.rung).toBeLessThan(scaleForExtent(extent));
    expect(cardTextFit(LONG, fit.extent, fit.rung).fits).toBe(true);
  });

  it("should never propose a rung above what the box's own proportions imply", () => {
    for (const extent of [
      { width: 288, height: 240 },
      { width: 160, height: 400 },
      { width: 1200, height: 900 },
    ]) {
      expect(cardFit(SHORT, extent).rung).toBeLessThanOrEqual(scaleForExtent(extent));
    }
  });

  it("should keep the box it was given when the writing already fits", () => {
    const fit = cardFit(SHORT, BOX);

    expect(fit.rung).toBe(1);
    expect(fit.extent).toEqual(BOX);
  });

  it("should never shrink the box it was given", () => {
    for (const rung of SUITE_TYPE_LADDER) {
      const extent = { width: 900 * rung, height: 700 * rung };
      const fit = cardFit(LONG, extent);
      expect(fit.extent.width).toBeGreaterThanOrEqual(extent.width);
      expect(fit.extent.height).toBeGreaterThanOrEqual(extent.height);
    }
  });

  it("should give a bigger box a rung at least as large, never smaller", () => {
    let previous = 0;
    for (const height of [120, 200, 320, 520, 900, 1600]) {
      const fit = cardFit(LONG, { width: 288, height });
      expect(fit.rung).toBeGreaterThanOrEqual(previous);
      previous = fit.rung;
    }
  });

  it("should grow a box that cannot hold even the smallest type", () => {
    const tiny = { width: 40, height: 30 };
    const fit = cardFit(LONG, tiny);

    expect(fit.rung).toBe(SUITE_TYPE_LADDER[0]);
    expect(fit.extent.height).toBeGreaterThan(tiny.height);
    expect(cardTextFit(LONG, fit.extent, fit.rung).fits).toBe(true);
  });

  it("should answer a rung the ladder actually has", () => {
    for (const height of [80, 240, 640, 2000]) {
      expect(SUITE_TYPE_LADDER).toContain(cardFit(LONG, { width: 288, height }).rung);
    }
  });

  it("should be deterministic", () => {
    expect(cardFit(LONG, BOX)).toEqual(cardFit(LONG, BOX));
  });
});
