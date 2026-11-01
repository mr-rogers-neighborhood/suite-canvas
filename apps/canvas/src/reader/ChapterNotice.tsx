import type { SanitiseReport } from "../archive/epub/sanitise";
import { IconGlyph } from "../icons/IconGlyph";

/**
 * What the book lost on the way to the page.
 *
 * `sanitiseChapter` refuses things on purpose — script, frames, remote pictures, the book's own stylesheet — and it
 * names every refusal in a report. That report used to be built and thrown away, so a chapter that had quietly lost
 * its illustrations read like a chapter that never had any, and the reader had no way to tell.
 *
 * Two refusals are worth a sentence, because both are visible losses. A remote picture is the interesting one: the
 * book points at a URL, and fetching it would tell a third party who is reading what, so it is dropped instead. The
 * routine ones — a book's stylesheet, the `meta` and `link` elements around it — are not, and saying so every chapter
 * would be noise the reader learns to skip.
 */
export function ChapterNotice({ report }: { report: SanitiseReport }) {
  const lines: string[] = [];
  if (report.remote.length > 0) {
    lines.push(
      report.remote.length === 1
        ? "One picture was not loaded: this book points outside itself."
        : `${String(report.remote.length)} pictures were not loaded: this book points outside itself.`,
    );
  }
  if (report.hadScript) lines.push("Script in this chapter was removed.");

  if (lines.length === 0) return null;

  return (
    <p className="reader-note" data-testid="reader-chapter-notice">
      <IconGlyph icon="lucide:shield-alert" size={13} />
      {lines.join(" ")}
    </p>
  );
}
