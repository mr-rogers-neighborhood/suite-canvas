/**
 * Bars and points, from a count or a field.
 *
 * Pure: the caller hands it one row per card — the buckets the card belongs to and the value the
 * measure produced — and gets back the series the chart draws. Keeping the aggregation out of the
 * drawing is what lets a chart be a test rather than a picture, and what lets the same numbers feed a
 * card, an embed and the presentation surface.
 */
export interface ChartRow {
  readonly id: string;
  /** The bucket labels this card answers to; more than one for a card carrying several tags. */
  readonly buckets: readonly string[];
  /** The measure's contribution: 1 for a count, the field's value for a sum. */
  readonly value: number;
}

export interface ChartBucket {
  readonly label: string;
  readonly value: number;
  /** How many cards landed in the bucket, which is what an average divides by. */
  readonly count: number;
}

export interface ChartSeries {
  readonly buckets: readonly ChartBucket[];
  /** The largest bar, so a renderer can scale without deciding what "full" means. */
  readonly max: number;
  /** Everything the buckets add up to, for the caption. */
  readonly total: number;
  /** True when nothing matched: a chart of nothing is a sentence, not an empty axis. */
  readonly empty: boolean;
}

export const NO_SERIES: ChartSeries = { buckets: [], max: 0, total: 0, empty: true };

/** The bucket a card with no value or no grouping falls into. */
export const UNGROUPED = "No group";

export interface ChartOptions {
  /** Divide each bucket by its card count, for an average rather than a sum. */
  readonly average?: boolean;
  /**
   * Keep the buckets in the order they were first seen rather than sorting by value. A line chart
   * wants the authored order; a bar chart usually wants the ranking.
   */
  readonly preserveOrder?: boolean;
}

export function chartSeries(rows: readonly ChartRow[], options: ChartOptions = {}): ChartSeries {
  if (rows.length === 0) return NO_SERIES;

  const order: string[] = [];
  const buckets = new Map<string, { value: number; count: number }>();

  for (const row of rows) {
    const labels = row.buckets.length === 0 ? [UNGROUPED] : row.buckets;
    for (const label of labels) {
      const bucket = buckets.get(label);
      if (bucket) {
        bucket.value += row.value;
        bucket.count += 1;
      } else {
        buckets.set(label, { value: row.value, count: 1 });
        order.push(label);
      }
    }
  }

  const series = [...buckets.entries()].map(([label, bucket]) => ({
    label,
    value: options.average === true ? bucket.value / bucket.count : bucket.value,
    count: bucket.count,
  }));

  if (options.preserveOrder !== true) {
    series.sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
  } else {
    series.sort((left, right) => order.indexOf(left.label) - order.indexOf(right.label));
  }

  const max = series.reduce((highest, bucket) => Math.max(highest, bucket.value), 0);
  const total = series.reduce((sum, bucket) => sum + bucket.value, 0);
  return { buckets: series, max, total, empty: series.length === 0 };
}

/** A number from a property value, or null when it is not one. */
export function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
