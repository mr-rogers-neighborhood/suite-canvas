import type { HistoryPoint, HistoryRestorePreview } from "@suite/graph";

/**
 * Owns how a point reads in the panel: when it happened, and what restoring it
 * would do in words. Kept apart from the component so the wording is testable
 * without a DOM and cannot drift from the sentence the confirm button sits under.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "just now", "12 min ago", "3 h ago", "yesterday", "4 days ago", "on 3 May 2026". */
export function relativeTime(at: number | null, now: number): string {
  if (at === null) return "time unknown";
  const delta = now - at;
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${plural(Math.floor(delta / MINUTE), "min")} ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)} h ago`;
  const days = Math.floor(delta / DAY);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return `on ${new Date(at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

/** The second line of a row: how much one change wrote. */
export function pointDetail(point: HistoryPoint): string {
  if (point.current) return "This is the workspace now";
  const operations = plural(point.length, "operation");
  return point.origin ? `${operations} \u00b7 ${point.origin}` : operations;
}

export interface PreviewLine {
  /** What the line is about, for the glyph column. */
  kind: "restored" | "removed" | "changed";
  text: string;
}

/**
 * The preview as lines: what comes back, what goes, and what changes. The
 * sentence from the graph stays the confirm text; these lines are the detail
 * under it, naming up to three cards.
 */
export function previewLines(preview: HistoryRestorePreview): PreviewLine[] {
  const lines: PreviewLine[] = [];
  const { restored, removed, changed, restoredTitles, removedTitles } = preview;

  if (restored.cards > 0) {
    lines.push({
      kind: "restored",
      text: `${plural(restored.cards, "card")} come back${
        restoredTitles.length > 0 ? `: ${restoredTitles.join(", ")}` : ""
      }`,
    });
  }
  if (removed.cards > 0) {
    lines.push({
      kind: "removed",
      text: `${plural(removed.cards, "card")} removed${
        removedTitles.length > 0 ? `: ${removedTitles.join(", ")}` : ""
      }`,
    });
  }
  if (changed > 0) {
    lines.push({ kind: "changed", text: `${plural(changed, "card")} rewritten` });
  }
  for (const [kind, label] of [
    ["boards", "board"],
    ["sections", "section"],
    ["edges", "link"],
    ["tags", "tag"],
  ] as const) {
    if (restored[kind] > 0) {
      lines.push({ kind: "restored", text: `${plural(restored[kind], label)} come back` });
    }
    if (removed[kind] > 0) {
      lines.push({ kind: "removed", text: `${plural(removed[kind], label)} removed` });
    }
  }
  if (lines.length === 0) {
    lines.push({ kind: "changed", text: "Nothing in the document would change" });
  }
  return lines;
}
