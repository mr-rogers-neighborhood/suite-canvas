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
8. **One gallery, three kinds.** The library gains a **Templates** tab — a tab, not a dialog, because
   board templates already live there and a second surface would split one question in two. It lists
   type blueprints, board templates and offered cards together, filterable by kit tag, and every row
   opens the same install sheet: a checklist of the fields plus the starter content, with a preview of
   what will be created. The checklist is the UI for the `fields` scope, so a partial install is the
   normal path rather than a hidden one. A card's starter content stays *attached* to its type (ADR-0038) unless the
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

## Amendment 2026-10-25: "Blueprint" is the family name, not the type-only one

The author asked whether a **board template** should also be called a Blueprint, since that mirrors the
railway.com model more closely. It should — and the umbrella reading is cleaner than the one this ADR
originally took:

- A **blueprint** is an installable starting point. There are two kinds: a **type blueprint** (seeds a
  type — this ADR) and a **board blueprint** (seeds a board — ADR-0040's board template, renamed in the
  interface).
- **"Template" leaves the user vocabulary.** ADR-0038's meaning (the card a new card is copied from) is
  now the **starter card**; the board idea is a **board blueprint**. Code keeps `templateCardId` and
  `setBoardTemplate` — renaming stable schema identifiers buys nothing.
- **One gallery, both kinds, one install sheet.** A board blueprint installs by duplication, a type
  blueprint by this ADR's command; the sheet differs in what it lists, not in how it reads.

This is why decision 8's "Templates tab" is a **Blueprints** tab.

## Amendment 2026-10-25: three ways in, and a Types tab

The author specified where the shelf is reached, which is a usability decision worth recording because a
catalogue nobody finds is a catalogue nobody uses:

1. **"Browse blueprints"** below **Manage types** in the add-card menu — the moment a user is choosing
   what to make.
2. **"Browse blueprints"** below **Add types** in the type editor — the moment a user is authoring a type
   and would otherwise build a field list from scratch.
3. **A Types tab in the library**, beside Cards, Boards, Sketches and Trash, listing the workspace's own
   types with the usual row controls, and **suggested blueprints appended below** based on what the
   workspace already has (a book type suggests a character and a location; a project type suggests a
   milestone). Suggestions are a list, never automatic installs.

The Types tab also gives types the affordances every other library row has — which is the answer to "where
do I manage my types" that does not require opening a modal.

**Bulk editing and large libraries are one problem, not two.** Every library tab now needs it: select
several rows and trash, unplace, place, tag or import them together; and a section that grows past a
screenful needs to stay usable (a filter that survives, a stable sort, and rows that do not re-render on
every keystroke). That work belongs to the library's own gate rather than to any single tab.

## Settled at writing time (2026-10-25)

- **The name is "blueprint" for the family**, with a *type blueprint* and a *board blueprint* as its two
  kinds; a type's seed card is its **starter card**. See the amendment above.
- **A kit is a tag, and a kit's page is a lens.** No kit record.
- **It is built after A33 and A34**, not as an Alpha gate: a blueprint declares fields, so the field
  editor and the composite kinds come first. The model is recorded now because it constrains what
  install must do (mint ids, refuse an unknown kind).
- **The gallery is a tab in the library**, and installing opens one checklist sheet shared by all
  three kinds.
- **Provenance is recorded and shown** as a row on the installed type ("from Kit X"), because a user who
  cannot see where a schema came from cannot judge whether to trust it. Updates stay manual.
- **A small shelf ships in the repository**, seeded offline: two or three kits that demonstrate the
  shape (a research kit, a project kit, a personal-CRM kit) rather than a large curated catalogue. A
  large shelf is content work with a maintenance tail — every shipped blueprint is a schema we would
  then want to keep good — and it teaches nothing that three good examples do not. Users and
  third parties ship the long tail as boards.
