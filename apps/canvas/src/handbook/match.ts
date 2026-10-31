import { type Target, targetKey } from "@suite/graph";
import type { HandbookArticle } from "./types";

/**
 * What the handbook shows for this screen.
 *
 * The rule is ADR-0045 §3: an article is listed when its subject can be satisfied right now, and
 * the badge is a count of what on screen is documented. Both are computed here, from two inputs
 * and nothing else, so the awkward cases are tests rather than things discovered by looking at a
 * board.
 *
 * `present` holds `kind:id` keys for everything the screen can actually point at: the cards and
 * sections on the board, the active board itself, and every shell region whose element is in the
 * DOM. An article with no targets is never listed; it is readable, but it documents a system
 * rather than an element, and inventing a subject for it would make the count lie.
 */
export interface HandbookMatch {
  /** Articles whose subject is on screen, most-related first. */
  readonly articles: readonly HandbookArticle[];
  /**
   * How many things on screen some article documents. This is the badge: "items", not
   * "articles", because two articles about the same control are still one thing on screen.
   */
  readonly items: number;
  /** Present target keys that no article documents, for an honest empty state. */
  readonly undocumented: number;
}

const EMPTY: HandbookMatch = { articles: [], items: 0, undocumented: 0 };

export function matchArticles(
  articles: readonly HandbookArticle[],
  present: ReadonlySet<string>,
  scope: readonly Target[] = [],
): HandbookMatch {
  if (present.size === 0 && scope.length === 0) return EMPTY;

  const documented = new Set<string>();
  const scored: { article: HandbookArticle; matched: number }[] = [];

  for (const article of articles) {
    let matched = 0;
    for (const target of article.targets) {
      const key = `${target.kind}:${target.id}`;
      if (present.has(key)) {
        matched += 1;
        documented.add(key);
      }
    }
    // An explain scope is a question the reader asked by selecting things, so an article that
    // answers any of it is listed even when the thing itself is off this board.
    const scoped = scope.filter((target) =>
      article.targets.some((own) => own.kind === target.kind && own.id === target.id),
    ).length;
    if (matched + scoped > 0) scored.push({ article, matched: matched + scoped });
  }

  // Fewest targets first among equals: an article about exactly this control is a better answer
  // than an article about five things one of which it happens to be. Then the authored order,
  // so the list does not reshuffle as the reader moves around.
  scored.sort(
    (left, right) =>
      right.matched - left.matched ||
      left.article.targets.length - right.article.targets.length ||
      left.article.order - right.article.order ||
      left.article.id.localeCompare(right.article.id),
  );

  return {
    articles: scored.map((entry) => entry.article),
    items: documented.size,
    undocumented: Math.max(0, present.size - documented.size),
  };
}

/** The first target of an article that is on screen, for the spotlight to point at. */
export function firstPresentTarget(
  article: HandbookArticle,
  present: ReadonlySet<string>,
): Target | null {
  const found = article.targets.find((target) => present.has(`${target.kind}:${target.id}`));
  return found === undefined ? null : { kind: found.kind, id: found.id };
}

/** Whether an article is about a target, which is how the list marks a row as the answer. */
export function articleAnswers(article: HandbookArticle, target: Target): boolean {
  return article.targets.some((own) => targetKey(own) === targetKey(target));
}
