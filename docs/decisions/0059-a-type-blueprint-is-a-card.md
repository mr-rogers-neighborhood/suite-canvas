# ADR-0059: A type blueprint is a card, and a kit is a tag

- **Status:** proposed — direction recorded, nothing built
- **Date:** 2026-10-25
- **Related:** [ADR-0038](./0038-a-type-template-is-a-card.md) (a type template is a card),
  [ADR-0040](./0040-a-board-and-a-section-are-identities.md) (boards and sections are identities),
  [ADR-0057](./0057-fields-can-compose.md) (fields can compose), [ADR-0016](./0016-semantic-core.md)
  (types, fields, tags), [ADR-0037](./0037-a-saved-view-is-a-lens.md) (a saved view is a lens),
  [ADR-0056](./0056-card-settings-owns-defaults.md) (Card Settings)

## Context

The author wants the Capacities-style shelf of ready-made objects: a large set of primitives a user
can add to their own workspace instead of building "Character" from a D&D ruleset by hand. Grouped
flexibly into **Kits**, and installable *partially* — a single field, or just the starter content —
because a field configuration can be the hard part and the rest may be unwanted. Users can author
their own.

The tree already has two template ideas, and the third collides with one of them:

- **ADR-0038:** a type's *template card* — the card a new card of that type is copied from. Its id
  lives on the type as `templateCardId`.
- **ADR-0040:** a **board template** — a board flagged as a template, applied by duplicating it.
- The author's **"Type Template"** — a catalog entry that seeds a *type*.

Two constraints make a naive version expensive:

1. **Field ids are unique across the workspace** (ADR-0016 §1), so anything installed has to mint new
   ids rather than carry the catalog's ids into the user's document.
2. **A field kind is a contract with the app.** A catalog that could introduce an unknown kind would
   let a document declare a kind nothing renders — the four-place parity problem ADR-0057 names.

## Decision

**No new object class and no new root map: a blueprint is a card, a kit is a tag.**

1. **A type blueprint is an ordinary card on a catalog board.** Its body is the **starter content**
   (rich text, so it can be a real opening paragraph or a template skeleton), and a `Fields` list
   field declares the schema — a list of groups, one group per field, each with a name, a kind,
   options, and whether it is required. That is exactly the shape
   [ADR-0057](./0057-fields-can-compose.md) gives composite fields, which is why this needs no new
   storage: the declaration *is* data on a card.
2. **A kit is a tag.** Blueprints carry the kit's tag; a kit's page is a saved **lens** over that tag
   ([ADR-0037](./0037-a-saved-view-is-a-lens.md)). A blueprint can belong to several kits without
   being duplicated, and a kit needs no record of its own. "Simple metadata" in the author's sense
   (level range, genre, difficulty) is just more fields on the blueprint.
3. **Installing is one command with a scope.** `installBlueprint(cardId, scope)` where scope is
   `whole` (create the type, its fields and a starter card), `fields` (add the chosen fields to an
   existing type) or `body` (copy the starter content into an existing card). One undoable batch, and
   the catalogue is never written to.
4. **Install mints new ids.** A field id, a type id and a starter-card id are all new; the blueprint
   is a source, not a shared record. Importing a blueprint twice therefore creates two types, which is
   visible and reversible rather than subtle and shared.
5. **An unregistered field kind is refused, with a reason.** The kind registry
   (`apps/canvas/src/field/fieldKindRegistry.tsx`) plus the schema enum is the gate: a blueprint that
   names a kind this build cannot render installs everything *except* that field, and says which field
   it skipped. Silent drops are how a document ends up half-populated.
6. **Provenance is recorded, updates are never automatic.** The installed type records the blueprint id
   and its kit. That makes "this came from Kit X" answerable and a future "the blueprint has more
   fields now" offer possible. Nothing re-installs itself: a type the user edited must never be
   rewritten by a catalog change.
7. **The built-in catalogue is repository data, seeded offline.** It ships the way the starter boards
   do; nothing is fetched at runtime. A catalogue is content, not a service (the supply-chain rule that
   already governs tours).
8. **One gallery, three kinds.** The library gains a **Templates** view that lists type blueprints,
   board templates and offered cards together, filterable by kit tag, each row installable with the
   scope the kind allows. A card's starter content stays *attached* to its type (ADR-0038) unless the
   card is offered on its own.
9. **Vocabulary, so the three do not keep colliding.** A type's seed card is its **starter card**
   (`templateCardId` keeps its name in code); a board's seed is a **board template**; a catalogued
   type is a **type blueprint**. We do not use "type template" for the third, because ADR-0038 already
   means the second thing by it.

### Why a blueprint is not a type record

The tempting shortcut is a `blueprints` root map of type-shaped records: query cheaper, and no
declaration-in-fields awkwardness. It is rejected for the same reason ADR-0040 rejects a board kind —
a blueprint would then need its own publishing, redaction, export, search, sharing and permission
story, all of which a card already has. A shelf of primitives is *content*.

## Consequences

- **The catalogue is shareable and remixable for free.** A user's own kit is a board they can share,
  publish, export, or duplicate — because it is a board of cards.
- **A kit can be sold later without a new mechanism.** Publishing a board already exists; a paid kit
  would be a published board with a paywall, not a marketplace product.
- **Install is the only new machinery**, and it is a composition of existing writes: `createType`,
  `addField`, `createCard`, `setProperty`.
- **A blueprint's declaration can drift from reality.** Nothing stops a blueprint from declaring a
  field name the app would never create; install validates through the same writers a user's own edit
  goes through, so an invalid declaration fails loudly at install time rather than mid-typing.
- **The gallery is the first place two template kinds share a surface.** That is deliberate: three
  galleries would teach the user three mental models for "add something ready-made".

## Rejected alternatives

- **A `blueprints` root record.** A second schema-bearing class with its own lifecycle, for content a
  card already models.
- **A kit as a board.** It forces one home per kit and makes "in three kits" duplication. A tag plus a
  lens gives the grouping without the ownership.
- **Installing by copying ids.** Two workspaces would share a field id, and every read that assumes
  uniqueness (ADR-0016 §1) would be a latent bug.
- **Auto-updating installed types from the blueprint.** It rewrites a user's schema behind their back
  and cannot merge their edits.
- **A network catalogue.** A remote type catalogue is a supply chain and a privacy surface for a
  local-first app; the built-in shelf ships in the binary, and a user's shelf ships as a board.
- **Naming it "Type Template".** ADR-0038 already means the starter card by that phrase; a second
  meaning makes every future sentence about templates ambiguous.

## Open questions this ADR does not settle

- Whether the gallery lives inside the library drawer (its existing tabs) or as its own dialog.
- Whether a kit shows as a section-per-kit board or a tag-filtered lens page; the decision above
  permits both, and the difference is presentation only.
- Whether install provenance is visible in the UI at all, or only recorded.
