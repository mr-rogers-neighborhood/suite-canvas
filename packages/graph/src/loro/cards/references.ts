import { fromEntries } from "remeda";
import { isMap } from "../../records/values.js";
import { mentionTargets, sameTargets } from "../../references.js";
import { INDEX_ORIGIN } from "../constants.js";
import type { DocContext } from "../context.js";
import { NO_REFERENCES } from "../model.js";

/**
 * Owns the derived reference index: which cards a body mentions, rebuilt from text rather
 * than written by hand.
 */

export function referencesMethods(ctx: DocContext) {
  return {
    /**
     * Outgoing reference ids for a card, sorted. Identity-stable until the set
     * changes; callers must not mutate the returned array.
     */
    referencesFor(cardId: string): string[] {
      const cached = ctx.referenceCache.get(cardId);
      if (cached) return cached;
      const value = ctx.references.get(cardId);
      const targets = isMap(value) ? value.keys().sort() : NO_REFERENCES;
      ctx.referenceCache.set(cardId, targets);
      return targets;
    },

    /** The derived index in the shape the snapshot consumes. */
    listReferences(): Record<string, string[]> {
      return fromEntries(
        [...ctx.references.keys()]
          .map((cardId) => [cardId, ctx.api.cards.referencesFor(cardId)] as const)
          .filter(([, targets]) => targets.length > 0),
      );
    },

    /** What the card's title and body mention right now, ignoring the index. */
    contentTargets(cardId: string): string[] {
      return mentionTargets([ctx.api.cards.peekTitle(cardId), ctx.api.cards.peekContent(cardId)]);
    },

    storedTargets(cardId: string): string[] {
      const value = ctx.references.get(cardId);
      return isMap(value) ? value.keys() : NO_REFERENCES;
    },

    /**
     * Repairs entries whose stored set disagrees with their content. Idempotent:
     * a second call writes nothing. Safe to run on every client after the first
     * sync, which is what makes the index converge without coordination.
     */
    ensureReferences(): number {
      const changed: Array<[string, string[]]> = [];
      for (const card of ctx.api.cards.listCards()) {
        const targets = ctx.api.cards.contentTargets(card.id);
        if (!sameTargets(ctx.api.cards.storedTargets(card.id), targets))
          changed.push([card.id, targets]);
      }
      if (changed.length === 0) return 0;
      ctx.api.cards.writeReferences(changed);
      return changed.length;
    },

    /** Rewrites every card's entry and drops entries for cards that are gone. */
    rebuildReferences(): number {
      const entries = ctx.api.cards
        .listCards()
        .map((card) => [card.id, ctx.api.cards.contentTargets(card.id)] as [string, string[]]);
      const wanted = new Set(entries.map(([cardId]) => cardId));
      const stale = ctx.references.keys().filter((cardId) => !wanted.has(cardId));
      ctx.api.cards.writeReferences(entries, stale);
      return entries.length;
    },

    /** One commit for any number of cards, so the index is never half-written. */
    writeReferences(entries: Array<[string, string[]]>, remove: string[] = []): void {
      for (const cardId of remove) {
        if (ctx.references.get(cardId) !== undefined) ctx.references.delete(cardId);
      }
      for (const [cardId, targets] of entries) {
        if (targets.length === 0) {
          if (ctx.references.get(cardId) !== undefined) ctx.references.delete(cardId);
          continue;
        }
        const map = ctx.references.ensureMergeableMap(cardId);
        const wanted = new Set(targets);
        for (const key of map.keys()) {
          if (!wanted.has(key)) map.delete(key);
        }
        for (const key of targets) {
          if (!map.get(key)) map.set(key, true);
        }
      }
      ctx.doc.commit({ origin: INDEX_ORIGIN });
    },

    /** Coalesces a burst of text edits into one re-parse per card. */
    scheduleReferences(): void {
      if (ctx.referencesScheduled) return;
      ctx.referencesScheduled = true;
      queueMicrotask(() => {
        ctx.referencesScheduled = false;
        const pending = [...ctx.pendingReferences];
        ctx.pendingReferences.clear();
        const changed: Array<[string, string[]]> = [];
        for (const cardId of pending) {
          if (!ctx.api.cards.getCard(cardId)) continue;
          const targets = ctx.api.cards.contentTargets(cardId);
          if (!sameTargets(ctx.api.cards.storedTargets(cardId), targets))
            changed.push([cardId, targets]);
        }
        if (changed.length > 0) ctx.api.cards.writeReferences(changed);
      });
    },
  };
}
