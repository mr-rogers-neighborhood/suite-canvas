# ADR-0046: The shell derives its colour from the theme

- **Status:** accepted
- **Date:** 2026-10-25
- **Related:** [ADR-0002](./0002-pnpm-monorepo.md), [ADR-0016](./0016-semantic-core.md), [ADR-0041](./0041-alpha-core-is-a-closed-feature-set.md), [`apps/canvas/src/styles/global.css`](../../apps/canvas/src/styles/global.css)

## Context

Theming was scoped as "utility classes applied to types and globals, user-friendly, not dev-oriented",
with two hard constraints from the author:

> The shell shouldn't contain its own colors. Definitely maintain this existing theme, but this allows
> the user to style the canvas and its elements, and the color of the shell be derived from it. A bit
> like apple's "Liquid glass" but more subtle … Same for highlight card styles, portal cards, sketches,
> etc. Can all share a style system and shell.

And the failure mode to avoid, from experience:

> I initially tried to make a cms/pkm combo which was a bad idea, but because it forced the user to
> think in cms terms for routing, slugs, etc. But the appearance styling/theming tools from powerful
> cms systems and page builders I think could still fit perfectly here.

The tree already has the raw material: `global.css` is token-driven (`--surface`, `--ink`,
`--hairline`, …) and both light and dark are expressed as token sets.

## Decision

**One token layer, one rule layer, and a shell with no palette of its own.**

1. **The shell owns no colours.** Every shell surface — app bar, tabs, dock, drawers, panels — reads the
   same tokens the canvas elements read. A theme change therefore moves the shell with it, and there is
   exactly one place a colour is defined.
2. **The existing look is the default theme, not a hard-coded one.** The current light/dark palettes
   become the "Sane defaults" theme, so a user who never opens appearance settings sees what they see
   today.
3. **Theming is rules over tokens, not CSS authoring.** A rule is a named record — a selector (type,
   card, portal, sketch, section, shell region, board), a small set of role assignments (surface, ink,
   accent, border, radius, density), and a scope. Users compose rules; they never write selectors or
   values. Utility-class *semantics* without a class string the user has to spell.
4. **Global rules and type rules are the same shape.** A global rule applies everywhere; a type rule
   applies to every card of that type; both are ordered, with the more specific scope winning.
5. **Derived values are computed, not asked for.** Given a card's surface and ink, the border, the
   hover tint and the dimming overlay follow. A theme author sets intent; the system derives the rest,
   which is what keeps a user theme from becoming unreadable.
6. **Readability is guarded.** A rule that would put ink on a surface below a contrast floor is
   corrected and reported rather than applied silently. The floor is a token constant, not a per-rule
   setting.
7. **Icons are a style value.** A preset library ships locally; an optional Iconify key expands it and
   is cached locally. A board, section, type, card or a free icon on the canvas stores an icon
   reference, never markup.

## Rejected alternatives

- **A CSS variables editor.** It is a developer tool wearing a settings skin, and it makes every
  user-authored theme a support case. Rules over a closed vocabulary are what make "not dev-oriented"
  true.
- **Style a card by editing its class list** (the WordPress/Bricks model literally). The user would
  need to learn the DOM. The vocabulary here is *roles on entities*, which is the part of those tools
  people actually use.
- **A separate shell theme.** Two palettes that must be kept in agreement is the bug the author is
  asking to prevent; deriving the shell is the fix.
- **Per-card colour overrides as the primary path.** They do not scale past a handful of cards and
  cannot be changed in one place later. Per-card override stays available as an *exception* layered on
  a rule.
- **Icons as embedded SVG per entity.** Markup in the document cannot be themed, searched or swapped.

## Consequences

- **`global.css` is refactored into role tokens**, with the current values becoming the default theme.
  Any hard-coded colour outside the token block is a defect this ADR names.
- **The theme is shared state.** Themes live on the workspace document (so collaborators see the same
  board styling), while "which theme am I viewing with" stays UI state — the same split as views.
- **Density and radius join colour in the vocabulary**, because the author asked for the shell to adapt
  "around the user's own theme system", and spacing is half of how a theme reads.
- **The icon field is additive.** Boards and sections already have optional colour; an optional icon is
  the same shape, and no new record class appears.
- **This is the last core surface to build**, because it reaches every other one. A surface built after
  the token refactor inherits the system; a surface built before it must be migrated.
