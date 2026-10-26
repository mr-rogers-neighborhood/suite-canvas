# ADR-0016: Semantic core — types, fields, tags and properties

- **Status:** accepted
- **Date:** 2026-10-21

## Context

[ADR-0014](./0014-semantic-model.md) fixed the target semantics: one schema-bearing type per card,
freeform tags, typed fields, relations separate from drawings. It deliberately left the storage
shape open and called itself "not an implemented refactor".

The canvas is now a dependable collaborative surface, so the next risk is the object model. Every
remaining capability — views, dashboards, templates, relation constraints — reads a card's type and
properties. The migration is cheapest while the card record is still small.

Two questions had to be settled before writing it:

1. **Does a card hold one type or many?** Tana-style supertags are expressive, but they push three
   unresolved questions into the first release: which type's form to show, what "required" means
   across types, and how two same-named fields render.
2. **What happens to values when a type or field disappears?** A single-select UI is only acceptable
   if switching type cannot feel destructive.

## Decision

1. **Types and tags are workspace records, fields are owned by types.** `types` and `tags` are root
   maps; fields live in `types.<id>.fields`. A field id is unique across the workspace. There is no
   shared field library in this version, so two types may each define "Status"; the inspector
   disambiguates by grouping properties under their type.

2. **A card stores type membership as a set plus a primary id.** `cards.<id>.types` is a
   `LoroMap<typeId, true>` and `cards.<id>.primaryTypeId` names the primary. This mirrors tag
   membership: concurrent add/remove of *different* types merges instead of resolving a whole array
   last-write-wins. The UI exposes a single-select picker for now; the graph layer accepts N types.

3. **The primary type owns presentation, never behaviour.** It drives the glyph, colour and (later)
   the creation template. Additional types only add fields. **No code may branch on a combination of
   types.** That rule, not the one-type limit, is what prevents a combinatorial explosion: the
   implementation cost stays linear in types + fields.

4. **Field kinds are structured scalars.** `text`, `number`, `date`, `select`, `multiSelect`,
   `checkbox`. Relation fields arrive with the relation refactor. A field's kind is immutable after
   creation; changing it means deleting and recreating the field, which avoids a silent coercion
   rule and a bulk-rewrite path.

5. **Property values are encoded natively, one key per field.** Text/date/select store a string,
   number stores a number, checkbox stores a boolean, and multi-select stores a nested
   `LoroMap<optionId, true>` so two people selecting different options keep both. Select values store
   the **option id**, so renaming an option is one workspace write. Writers validate the value
   against the card's field definition.

6. **Values are dormant, not deleted.** Removing a field, switching a card's type, or removing a tag
   hides the value without erasing it. Re-adding the field, switching back, or restoring the record
   revives it. Card reads keep dormant keys; views render only fields of the card's types.

7. **Required fields are advisory.** The inspector shows a completeness dot. Nothing blocks an edit,
   a collaborator's write, or a card save. A stricter rule would make offline and concurrent editing
   produce cards that cannot be repaired without a schema decision.

8. **Deleting a type reassigns its cards in one commit.** The command takes a replacement type
   (default `note`), rewrites membership and the primary id for affected cards, deletes the type, and
   reports the count. The built-in `note` type cannot be deleted. Reads still tolerate a dangling
   type id, because a collaborator can add a type while the deletion is in flight.
   Deleting a **tag** leaves membership dormant; tag queries filter by existing tag records, so a
   deleted tag simply stops appearing.

9. **Seeding is structural, not sample data.** Every workspace gets `note`, `concept` and `source`
   with fixed ids, so concurrent seeding converges and no card is ever typeless. `meta.schemaVersion`
   moves to 3. Legacy `kind`/`data` keys are ignored on read and removed when a record is rewritten;
   no destructive migration is needed because a card with no type is a note.

## Consequences

- **Multi-type is additive.** Enabling "add another type" later is a UI change; the data model,
  merge behaviour and dormant-value rules are already in place.
- **Type switching is safe**, which is what makes a single-select picker honest rather than
  destructive.
- **Field duplication is possible.** Two types can define "Status" independently, with separate
  values and no synchronisation. That is the cost of type-owned fields; a shared field library is a
  later, additive feature.
- **Dormant values accumulate.** They are cheap (one map key), but a future "clean orphan values"
  command may be useful after many schema edits.
- **Kind changes are a migration**, not an edit. The UI does not offer them.
- **The index summary is now defined**: title, primary type, type membership, tags and scalar
  properties can all be read without a card body, which is what the future index/card-document split
  needs.

## Rejected alternatives

- **A scalar `typeId`.** Simplest, and a later migration would be mechanical, but membership as a
  set costs almost nothing and makes concurrent add/remove correct by construction. The one-way
  door is the storage shape, so it is cheaper to close it now.
- **Multiple supertags in the UI now.** It doubles the decisions (form, required, icon precedence,
  field-name collisions) before the basic type + field loop has been used. It remains a UI-only
  follow-up.
- **Strict required fields.** Blocking writes turns a schema disagreement into an editing dead end,
  especially for offline clients.
- **A shared workspace field library.** Shared fields need referential integrity across types;
  type-owned fields keep deletion and ownership unambiguous.
- **Deleting values with their field/type.** It makes a routine schema edit destructive and
  unrecoverable without a backup.

## Amendment 2026-10-25: multi-type is enabled, and kinds compose

§2's storage shape stands unchanged, and its "it remains a UI-only follow-up" sentence is now superseded:
[ADR-0053](./0053-supertags-are-multi-type.md) enables the multi-type picker under the rules §3 already set
(primary owns presentation, extra types only add fields, no code branches on a combination).

§4's kind list widens under [ADR-0057](./0057-fields-can-compose.md) with `rating`, `group` and `list`, one
level of nesting. §4's other promise — **a field's kind is immutable after creation** — is unchanged and now
also forbids a composite kind becoming a scalar.
