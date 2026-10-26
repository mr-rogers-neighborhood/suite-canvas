import type { StyleRule } from "@suite/graph";
import { describe, expect, it } from "vitest";
import {
  cardsChangedByPromotion,
  moveRule,
  nextRuleOrder,
  ruleForScope,
  ruleNameFor,
  sameScope,
  surfacesUnderRule,
  upsertScopedRule,
  withoutRule,
  withRuleStyle,
} from "./styleTargets";

/**
 * The ladder being writable ([ADR-0071](../../../docs/decisions/0071-style-is-derived-not-configured.md)).
 *
 * These are the properties the editor leans on: browsing a rung writes nothing, the first edit creates
 * exactly one rule at the end of the order, an edit cannot disturb a rule's identity, and the confirm
 * before a promotion counts what the write will actually change.
 */

const rule = (over: Partial<StyleRule> & Pick<StyleRule, "id" | "scope">): StyleRule => ({
  name: over.id,
  order: 0,
  style: { radius: 8 },
  ...over,
});

const everywhere = rule({ id: "r-global", scope: { kind: "global" } });
const concepts = rule({ id: "r-concept", scope: { kind: "type", id: "t-concept" } });

describe("naming a scope", () => {
  it("says the group in the reader's words", () => {
    expect(ruleNameFor({ kind: "global" })).toBe("Everywhere");
    expect(ruleNameFor({ kind: "type", id: "t-concept" }, { typeName: "Concept" })).toBe(
      "Every Concept",
    );
    expect(ruleNameFor({ kind: "kind", id: "card" }, { kindLabel: "card" })).toBe("Every card");
    expect(ruleNameFor({ kind: "shell", id: "app-bar" })).toBe("Every app bar");
  });
});

describe("finding the rule for a scope", () => {
  it("matches on kind and id together", () => {
    expect(ruleForScope([everywhere, concepts], { kind: "type", id: "t-concept" })?.id).toBe(
      "r-concept",
    );
    // A rule for a *different* type is not this type's rule.
    expect(ruleForScope([concepts], { kind: "type", id: "t-note" })).toBeUndefined();
    expect(sameScope({ kind: "global" }, { kind: "global" })).toBe(true);
    expect(sameScope({ kind: "global" }, { kind: "kind", id: "card" })).toBe(false);
  });
});

describe("writing a rule", () => {
  it("keeps the rule's name, order and scope and only replaces its assignments", () => {
    const next = withRuleStyle([everywhere, concepts], "r-concept", { surface: "accent" });
    expect(next[1]).toEqual({ ...concepts, style: { surface: "accent" } });
    // The other rule is untouched, by value.
    expect(next[0]).toBe(everywhere);
  });

  it("creates the scoped rule on first edit, last in the order", () => {
    const existing = rule({ id: "r-a", scope: { kind: "kind", id: "card" }, order: 3 });
    const next = upsertScopedRule([existing], {
      scope: { kind: "type", id: "t-concept" },
      style: { radius: 14 },
      name: "Every Concept",
      id: "r-new",
    });

    const created = next.find((entry) => entry.id === "r-new");
    expect(created).toEqual({
      id: "r-new",
      name: "Every Concept",
      // Past everything that exists: a new edit must not win against rules already in force.
      order: 4,
      scope: { kind: "type", id: "t-concept" },
      style: { radius: 14 },
    });
  });

  it("edits the scope's existing rule rather than adding a second one for it", () => {
    const next = upsertScopedRule([concepts], {
      scope: { kind: "type", id: "t-concept" },
      style: { radius: 20 },
      name: "Every Concept",
      id: "r-different-id",
    });

    expect(next).toHaveLength(1);
    expect(next[0]).toEqual({ ...concepts, style: { radius: 20 } });
  });

  it("numbers a first rule from zero when the list is empty", () => {
    expect(nextRuleOrder([])).toBe(0);
  });

  it("removes by id and nothing else", () => {
    expect(withoutRule([everywhere, concepts], "r-concept")).toEqual([everywhere]);
  });
});

describe("ordering", () => {
  const a = rule({ id: "a", scope: { kind: "kind", id: "card" }, order: 0 });
  const b = rule({ id: "b", scope: { kind: "kind", id: "section" }, order: 1 });
  const c = rule({ id: "c", scope: { kind: "kind", id: "board" }, order: 2 });

  it("moves a rule one place", () => {
    const down = moveRule([a, b, c], "b", 1);
    expect(down.map((entry) => entry.id)).toEqual(["a", "c", "b"]);
    expect(down.map((entry) => entry.order)).toEqual([0, 1, 2]);

    const up = moveRule([a, b, c], "b", -1);
    expect(up.map((entry) => entry.id)).toEqual(["b", "a", "c"]);
  });

  it("does nothing at either end, rather than wrapping", () => {
    // A move that wrapped would silently reorder the ladder the reader is looking at.
    expect(moveRule([a, b, c], "a", -1).map((entry) => entry.order)).toEqual([0, 1, 2]);
    expect(moveRule([a, b, c], "c", 1).map((entry) => entry.order)).toEqual([0, 1, 2]);
  });

  it("renumbers a list that arrived with duplicate orders", () => {
    const twins = [
      rule({ id: "x", scope: { kind: "global" }, order: 0 }),
      rule({ id: "y", scope: { kind: "kind", id: "card" }, order: 0 }),
    ];
    const moved = moveRule(twins, "y", -1);
    expect(moved.find((entry) => entry.id === "y")?.order).toBe(0);
    expect(moved.find((entry) => entry.id === "x")?.order).toBe(1);
  });
});

describe("what a write would change", () => {
  const cards = [
    { primaryTypeId: "t-concept", style: undefined },
    { primaryTypeId: "t-concept", style: { radius: 4 } },
    { primaryTypeId: "t-concept", style: {} },
    { primaryTypeId: "t-note", style: undefined },
  ];

  it("counts a promotion by the cards that will actually move", () => {
    // The card with a style of its own keeps it — a card beats any rule — so promising "3 cards" would
    // promise more than the write delivers. An empty style is not a style, so that card does move.
    expect(cardsChangedByPromotion(cards, "t-concept")).toBe(2);
  });

  it("counts a rule's population for the delete confirm", () => {
    expect(surfacesUnderRule(concepts, cards)).toBe(3);
    expect(surfacesUnderRule(everywhere, cards)).toBe(4);
    expect(surfacesUnderRule(rule({ id: "s", scope: { kind: "shell", id: "dock" } }), cards)).toBe(
      1,
    );
  });
});
