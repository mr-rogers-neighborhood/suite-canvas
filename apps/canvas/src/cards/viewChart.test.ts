import { describe, expect, it } from "vitest";
import { chartSeries, NO_SERIES, numericValue } from "./viewChart";

const row = (id: string, buckets: string[], value = 1) => ({ id, buckets, value });

describe("chart series", () => {
  it("should be empty, not a flat axis, when nothing matched", () => {
    expect(chartSeries([])).toEqual(NO_SERIES);
  });

  it("should count cards per bucket and rank the bars", () => {
    const series = chartSeries([row("a", ["Note"]), row("b", ["Note"]), row("c", ["Character"])]);

    expect(series.buckets).toEqual([
      { label: "Note", value: 2, count: 2 },
      { label: "Character", value: 1, count: 1 },
    ]);
    expect(series.max).toBe(2);
    expect(series.total).toBe(3);
  });

  it("should give a card with no bucket a bucket rather than dropping it", () => {
    const series = chartSeries([row("a", [])]);
    expect(series.buckets).toEqual([{ label: "No group", value: 1, count: 1 }]);
  });

  it("should count a card in every bucket it answers to", () => {
    // A card with two tags is in both: that is what a tag means everywhere else in the app.
    const series = chartSeries([row("a", ["draft", "final"])]);
    expect(series.buckets.map((bucket) => bucket.label)).toEqual(["draft", "final"]);
  });

  it("should average by the cards in the bucket, not by the buckets", () => {
    const series = chartSeries([row("a", ["Note"], 4), row("b", ["Note"], 2)], { average: true });
    expect(series.buckets[0]?.value).toBe(3);
  });

  it("should keep the authored order when a line chart asks for it", () => {
    const series = chartSeries([row("a", ["Todo"]), row("b", ["Doing"]), row("c", ["Doing"])], {
      preserveOrder: true,
    });
    expect(series.buckets.map((bucket) => bucket.label)).toEqual(["Todo", "Doing"]);
  });

  it("should read a number out of a property that holds one", () => {
    expect(numericValue(12)).toBe(12);
    expect(numericValue("12.5")).toBe(12.5);
    expect(numericValue("not a number")).toBeNull();
    expect(numericValue(undefined)).toBeNull();
  });
});
