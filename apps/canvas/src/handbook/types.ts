/**
 * What a handbook article is, as the app reads it.
 *
 * The article is authored as Markdown in `handbook/` at the repository root and generated into
 * `articles.generated.ts` by `scripts/sync-handbook.mjs`, so this module describes the shape the
 * generator produces rather than a file anyone writes by hand in the app. The docs site reads
 * the same Markdown, which is the point: one source, two readers (ADR-0045 amendment).
 */
export type HandbookTargetKind = "ui" | "card" | "board" | "section";

export interface HandbookTarget {
  readonly kind: HandbookTargetKind;
  readonly id: string;
}

export interface HandbookArticle {
  /** `section/slug`, from the file path: stable, and what a deep link names. */
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  /** One line, used by a list row and the docs page. */
  readonly description: string;
  /** Section id from `handbook/_sections.json`. */
  readonly section: string;
  /** Order within the section, then within the list. Lower first. */
  readonly order: number;
  /**
   * What the article documents. Empty is allowed and means "readable, but not matched to
   * anything on screen" — a page about how selection works has no single element to point at,
   * and inventing one would make the badge lie.
   */
  readonly targets: readonly HandbookTarget[];
  /** The body, rendered at build time. */
  readonly html: string;
  /** The body as plain text, for search and the picker's secondary line. */
  readonly text: string;
}
