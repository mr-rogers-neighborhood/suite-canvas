# ADR-0038: A type template is a card

- **Status:** accepted
- **Date:** 2026-10-25
- **Related:** [ADR-0010](./0010-workspace-boards-and-cards.md), [ADR-0012](./0012-field-granular-records.md), [ADR-0016](./0016-semantic-core.md), [ADR-0029](./0029-portal-board-field.md), [`packages/graph/src/templateTitle.ts`](../../packages/graph/src/templateTitle.ts)

## Context

Types described a card's *shape* — fields, kinds, options — and nothing about what a new card of that
type should contain. `createCard({ typeId })` wrote an empty record, so a "Character" started exactly
like a blank note and the user retyped the same headings, the same property blocks and the same
starting values every time. A type that cannot say what its cards look like is half a type.

The obvious implementation is a stored body snapshot on the type record: serialize the ProseMirror
tree, write it into each new card at creation. It works, and it costs a second serialization format,
a converter back into Loro, and two editors — one that authors the template, one that authors a card.

## Decision

**A type template is an ordinary card, and the type names it.**

1. **One field.** `CardType.templateCardId?: string` is additive; a type without it behaves exactly
   as before. The schema parse, portable export (`types: CardType[]`) and sync carry it with no
   conversion.
2. **Creation copies, once.** `createCard({ typeId })` resolves the type's template — live and not in
   the trash — and copies its title tree, body tree, properties, tags and connectors into the new
   card, then places it where the caller asked. A `LoroDoc` batch makes it one undo step.
3. **A missing template is not an error.** A deleted or trashed template means "no template"; the
   card is blank, never a thrown switch. `createCard({ fromTemplate: false })` builds the template
   itself, so a template can never copy itself.
4. **The template is a card you edit.** No template editor exists: it is opened in the focus surface
   and edited with the same slash menu, property blocks and mentions as any other card. What you
   author is exactly what a new card becomes.
5. **Titles expand once, plainly.** A copied title is rich text, so mentions stay live chips. On top
   of that, a *plain* title may carry `{{Field Name}}` tokens, filled from the new card's own values
   at creation. `displayTitle` stays a plain string, so search, board tabs, mentions and shares are
   untouched. A formatted or mentioned title is copied verbatim — token expansion never rewrites
   rich text.

## Rejected alternatives

- **A serialized body snapshot on the type.** Needs a second format, a JSON→Loro writer, and a
  preview renderer that is not the real editor. `duplicateCard`'s copy primitive already does this
  correctly for title and body, marks included.
- **A hidden template store.** A template the user cannot see is a template they cannot fix. The
  template card is an ordinary unplaced card in the inbox: visible, editable, and never part of a
  board share, because projections are board- and card-scoped.
- **Live title tokens.** A title that re-renders from a property means every consumer of a title —
  search index, tabs, mention chips, library rows, share projections — learns to render rich text.
  That is a much larger change than the feature is worth, and it makes the title a view rather than
  a string people can rely on.
- **Per-field defaults on the type instead of a template.** A default value has no body, no
  property blocks and no ordering; it answers a different question.

## Consequences

- **Creating a card is a copy, not a construction.** New cards inherit more than the user may expect
  if the template carried tags or connectors; that is the point, and the type editor says so.
- **Deleting the template silently stops the templating.** The type keeps pointing at nothing. The
  type editor shows the template's title when it resolves and "Create" when it does not, so the
  state is visible rather than inferred.
- **`updateType` validates the reference.** A template id that is not a live card is refused, so the
  record cannot point at a random id.
- **Templates are cards, so they appear in search and the inbox.** Accepted and documented; if it
  becomes noise, the fix is a tag with a default library exclusion, not hidden state.
- **The next schema question is the interesting one.** A sketch or a drawing as a *field kind* would
  let one card hold a value and a drawing; a template can then seed both. That is pinned in
  `docs/roadmap/v2.md` §6.10a rather than assumed here.
