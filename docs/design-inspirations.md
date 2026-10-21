# Design inspirations

A design reference for Suite: the product shape we are aiming at, the inspirations we are
deliberately borrowing from, and the decisions that follow. This is **not** an ADR and **not** a
roadmap. It records direction and rationale so that individual features can be judged against it.

Status labels used for capabilities below:

| Label | Meaning |
| --- | --- |
| **current** | Implemented in this repository today. |
| **target** | Decided direction; not implemented. |
| **later** | Deliberately deferred until the model above it is stable. |
| **rejected** | Considered and declined; see the matrix's Reject column and the non-goals in §10. |

Related reading: [architecture.md](./architecture.md), [conventions.md](./conventions.md),
[ADR-0015](./decisions/0015-loro-as-crdt-engine.md),
[ADR-0003](./decisions/0003-typed-object-graph.md),
[ADR-0010](./decisions/0010-workspace-boards-and-cards.md),
[ADR-0011](./decisions/0011-library-dock-and-card-chrome.md),
[ADR-0012](./decisions/0012-field-granular-records.md).

## 1. Purpose and north star

Suite is a **local-first, collaborative tool for thinking**. The canvas is where ideas are arranged;
the workspace is the set of objects those arrangements are made of. A person should be able to open
the app offline, think in spatial structures, invite someone into a single card, and never feel that
they are filling in a website.

The north star in one sentence: **cards are objects, boards are contexts, and every published or
computed representation is a projection of the object graph, never the place the graph is authored.**

Three tests for any proposed feature:

1. **Does it help thinking?** If it only helps presentation, it belongs in a projection layer.
2. **Does it survive collaboration and offline use?** If it needs a server round-trip to be correct,
   it is not part of the core model.
3. **Is it stored or derived?** If it can be recomputed from stored facts, it must not become a
   second source of truth.

### Publishing is a projection

The hardest lesson from building knowledge tools is that **a knowledge tool is not a CMS**. Thinking
in web conventions — routes, slugs, templates, page trees — distorts the model: a card acquires
properties that only exist to make a website, and those properties then constrain how the card can
be reused. Suite therefore keeps publishing outside the core:

- The core stores cards, types, fields, relations, boards, placements and sections.
- A publishing pipeline reads a deterministic **bundle** and renders it elsewhere.
- Routes, slugs, templates and navigation are properties of a **publication**, not of a card.

A card can appear on five boards, in two views and on one website without knowing about any of them.

## 2. Inspiration matrix

| Source | Borrow | Reject | Why |
| --- | --- | --- | --- |
| **Heptabase** | Card library + whiteboards; one card on many boards; sections; sub-whiteboards; toolbar; card info and backlinks | Board-owned cards; mandatory document tree; whiteboard-as-the-only-container | Objects first, spatial contexts second. "Remove from board" is not "delete", and sub-boards are navigation, not ownership. |
| **Tana** | Supertags as typed objects; typed fields; saved queries/views; keyboard-first capture | A single uniform node type for everything; implicit graph semantics | A type must be light enough to apply while writing yet strong enough to drive fields and queries; a uniform node graph makes "object vs placement" ambiguous. |
| **Obsidian Semantic Canvas** | Canvas groups; labeled/typed links; deliberate canvas ↔ note property projection | Continuous two-way property sync on every move; note frontmatter as the schema | Projection should be an explicit command, not a background sync that silently rewrites cards. |
| **Obsidian Metadata Menu** | Typed field definitions; presets; autocomplete; per-type field sets | File/frontmatter as the storage model; per-note ad-hoc schemas | Field definitions are a workspace concern, not a per-file convention. |
| **Capacities** | Object types; object dashboards; backlinks; collections/queries | Daily-note-centric navigation as the primary shell; cloud-only assumptions | Object dashboards and backlinks are the retrieval layer we want; the shell stays canvas-first. |

## 3. Core vocabulary

| Term | Definition | Scope |
| --- | --- | --- |
| **Workspace** | The collaboration and storage boundary: one synced document today, an index plus card documents as the target. | Workspace |
| **Board** | A named context that shows placements of cards. A view, not an owner. | Workspace |
| **Card / object** | A workspace-level thing with identity, a type, fields, tags and body content. Exists without any board. | Workspace |
| **Placement** | Where a card sits on one board: position, size, layer. At most one per (board, card). | Board |
| **Type** | The single schema-bearing classification of a card. Defines fields, defaults and affordances. | Workspace |
| **Field** | A typed definition owned by a type: text, number, date, select, relation, etc. | Workspace |
| **Property** | A value on a card for one field of its type. | Card |
| **Tag** | A freeform label with no schema. Many per card. Used for retrieval, not validation. | Workspace |
| **Relation** | A typed semantic statement between two cards. Exists independently of boards. | Workspace |
| **Edge placement** | How a relation is drawn on one board: connectors, path, label, layer. | Board |
| **Section** | A named spatial region on a board. Membership is derived from placement geometry. | Board |
| **View / collection** | A saved query over the workspace, rendered as a list, table, gallery or board. Results are derived and read-only. | Workspace |
| **Template** | A creation recipe for a type: default fields and body. Instantiated, never linked. | Workspace |

### Type vs tag vs section vs view

These four are routinely conflated, and conflating them is how knowledge tools become CMSes.

| Question | Type | Tag | Section | View |
| --- | --- | --- | --- | --- |
| Does it define schema? | Yes, fields and validation | No | No | No (it filters schema) |
| How many per card? | Exactly one (primary) | Many | At most one per board, derived | N/A |
| Where does membership come from? | Explicit assignment | Explicit assignment | Geometry inside the board | Query evaluation |
| Is membership stored on the card? | Yes, `typeId` | Yes, tag keys | **No**, derived | **No**, derived |
| Is it board-scoped? | No | No | Yes | No (may be pinned to a board) |
| Can it change behavior? | Yes: forms, dashboards, templates | No: retrieval only | No: visual grouping | No: read-only result set |
| Can it be written implicitly? | No | Only by explicit command | Never | Never |

A **type** answers "what is this?". A **tag** answers "what else is this like?". A **section**
answers "where is it on this board?". A **view** answers "which cards match this question?".

## 4. Canonical data model

### 4.1 Current implementation

One `LoroDoc` per workspace (room and IndexedDB key are the workspace id). Cards, placements,
edges, types, tags and properties are field-granular per
[ADR-0012](./decisions/0012-field-granular-records.md); boards are still whole values.

| Map | Holds | Notes |
| --- | --- | --- |
| `boards` | `id`, `name`, `createdAt`, `updatedAt` | Boards are views inside one document. |
| `types` | `id`, `name`, `glyph`, `color?`, `createdAt`, `updatedAt`, `fields` | Fields are owned by their type ([ADR-0016](./decisions/0016-semantic-core.md)). |
| `tags` | `id`, `name`, `color?`, `createdAt` | Schema-free labels, workspace records. |
| `cards` | `createdAt`, `updatedAt`, `deletedAt`, `connectors`, `primaryTypeId`, `types`, `tags`, `properties` | Type/tag membership and properties are merge-safe nested maps. |
| `placements` | `boardId`, `cardId`, `x`, `y`, `z`, `createdAt`, `width?`, `height?` | Key `${boardId}/${cardId}`; one per pair. |
| `edges` | `boardId`, `source`, `target`, connectors, `kind`, `path`, `bidirectional`, `label?` | Semantic link and drawing are conflated in one record; still target for the relation split. |
| `content` / `titles` | `loro-prosemirror` tree per card | Body and title rich text, same document. |
| `meta` | `schemaVersion`, `seeded` | Current schema version is 3. |

Derived today: `homeBoardId` (oldest placement), `listBoardCards`, `listBoardEdges`,
`listInboxCards`, `listTrashedCards`, `displayTitle`, `viewCardFields` and
`listCardsOfType`/`listCardsWithTag`. Everything else is stored. **Sections, views, relations and
edge placements do not exist yet.** The card-doc split described below is target architecture, not
implemented behavior.

### 4.1a Current type model

Types and tags are implemented, with the storage shape chosen for a later multi-type UI:

- `cards.<id>.types` is `LoroMap<typeId, true>`; `primaryTypeId` names the primary. The picker is
  single-select today, but concurrent membership merges and multi-type needs no migration.
- Field kinds are `text`, `number`, `date`, `select`, `multiSelect` and `checkbox`. Relations fields
  wait for the relation split.
- Properties are keyed by field id. Scalars store natively; multi-select is a per-option map. See
  [ADR-0016](./decisions/0016-semantic-core.md).
- Required fields are advisory. Values are dormant when a field or type disappears, so switching
  type is non-destructive.
- **No behavior may branch on a combination of types**; types add schema, never behavior.

### 4.2 Target: index document plus card documents

The target is two record families with a deliberate asymmetry:

```
workspace index doc (small, hot, collaborative)
  boards, placements, sections, types, fields, tags,
  card summaries (title, typeId, tag keys, scalar properties),
  relations, edge placements, views

card doc (one per card, loaded on demand)
  body rich text, long-form blocks, attachments, per-card undo scope
```

Boards stay **views inside the index**; we explicitly reject a two-level `board → card` document
tree. A board has no document of its own, so placing, unplacing and moving a card between boards
remain single-document operations.

**Why this split.** The index is what the library, boards, queries, dashboards, backlinks and
navigation need. Loading a board must not require loading every body. The card doc is where the
bytes are, where carets and per-card undo live, and — critically — where a card-level ACL can apply.
The split also gives a natural share boundary: one card document is the unit that can be shared
"like a Notion page" without handing over the workspace index.

**What belongs in the index summary:**

| Field | Why index |
| --- | --- |
| `title` | Library rows, board headers, search, backlink labels. Short; char-wise `Y.Text` keeps concurrent renames mergeable. |
| `typeId` | Drives filtering, dashboards, forms and icons without loading bodies. |
| `tags` | Library filtering and view predicates. |
| scalar properties | Queries and views must evaluate without opening card docs. |
| `createdAt`, `updatedAt`, `deletedAt` | Ordering, sync bookkeeping, trash. |

**What belongs in the card doc:** body rich text, embedded blocks, attachments, and any future
high-volume content. Excerpts are derived, not stored.

Titles stay in the index even though they are text: a title is a small, frequently read scalar-like
field, and pushing it into the card doc would make every library row and query pay a document load.
This is a deliberate exception to "rich text lives in card docs", not an accident.

### 4.3 Objects, types, fields, tags, properties

- `types` is a workspace map of type definitions: `id`, `name`, `icon`, `color`, and a `fields`
  map keyed by field id. The current closed `kind` enum becomes `typeId` on the card.
- Each field definition has an `id`, `name`, `kind`, `required`, `default`, and kind-specific
  options (select options, relation target types, number format).
- A card stores `typeId` (exactly one) and a `properties` map keyed by **field id**. Each property
  is its own key, so two people editing different fields merge.
- Tags are workspace records (`id`, `name`, optional `color`). Cards store tag membership as one key
  per tag id (`Y.Map<boolean>`), so concurrent add/remove of different tags never clobbers.
- Tag names are unique case-insensitively; renaming a tag is one workspace write, not N card writes.

### 4.4 Relations vs edge placements

The target mirrors cards/placements:

| Concept | Stores | Scope |
| --- | --- | --- |
| **Relation type** | `id`, `name`, `color`, directed/symmetric, allowed source and target types | Workspace |
| **Relation** | `id`, `relationTypeId`, `fromCardId`, `toCardId`, optional typed properties, `createdAt` | Workspace |
| **Edge placement** | `boardId`, `relationId`, `sourceConnector?`, `targetConnector?`, `path`, `label?`, `z` | Board |

Relation types are workspace records rather than a hard-coded enum: "references", "relates to" and
"tagged" become seeded relation types, and a user can add "contradicts" without a schema release.

Invariants:

- A relation exists whether or not any board draws it. Unplacing a card from a board does not delete
  a relation; it only suspends drawings whose endpoint is absent (the current "dormant edge"
  behavior becomes a property of edge placements).
- At most one edge placement per (board, relation), matching the card-placement rule. Two different
  statements need two relations, not two drawings of one.
- Deleting a relation deletes its edge placements. Deleting a board deletes only its edge
  placements.
- Several relations of different kinds may connect the same pair of cards.

**This split is a later refactor.** Today's `edges` record is both statement and drawing, scoped to
a board. The migration is mechanical: every current edge becomes a relation (endpoints, its `kind`
mapped to a seeded relation type, `label`) plus an edge placement (`boardId`, connectors, `path`,
`bidirectional` as an arrowhead option). We do not auto-deduplicate identical relations across
boards during migration; a merge is an explicit user action.

### 4.5 Boards, placements, sections, views

- `boards`: unchanged.
- `placements`: unchanged. Section membership is never stored on a placement.
- `sections`: `id`, `boardId`, `title?`, `x`, `y`, `width`, `height`, `z`, `color?`. Geometry only.
- `views`: `id`, `name`, serialized filter AST, sort, optional group-by, presentation, optional
  `pinnedBoardId`. No result membership is stored.

### 4.6 Derived vs stored

| Fact | Treatment | Rationale |
| --- | --- | --- |
| Home board | Derived: oldest placement | No concurrent pin race; leaving home promotes the next placement. **Current.** |
| Section membership | Derived from geometry | Drags must not rewrite cards; overlap rules can evolve. |
| View results | Derived by query | A stored result is a cache that will go stale and silently lie. |
| Backlinks | Derived from relations | One source of truth; no mirrored link properties. |
| `displayTitle` fallback | Derived | Existing cards migrate without a destructive text move. **Current.** |
| Inbox membership | Derived: alive, no placements | **Current.** |
| "Unread"/last-opened | Per-user, local or per-user record | Not workspace truth. |

Caches are allowed (for example, a materialized backlink index for speed) only if they are
discardable and rebuildable from stored facts.

### 4.7 Field-granular writes, always

The rule from [ADR-0012](./decisions/0012-field-granular-records.md) extends to every new record
family: **never write a whole record**, and never write a collection when one member changed.

- Card property updates write one `properties` key.
- Tag add/remove writes one tag key.
- Section move writes `x`/`y`, not the section.
- View edits write one field of the view.
- Relation endpoint changes write `fromCardId`/`toCardId`, not the relation.

A whole-record write makes unrelated concurrent edits resolve last-write-wins for the entire record.
That failure is silent, which is why the rule is non-negotiable rather than a preference.

## 5. Semantic rules

1. **One schema-bearing primary type per card.** Additional supertags are a **later**, additive
   feature. Starting with multiple types creates ambiguity immediately: which type validates the
   card, which dashboard owns it, what happens when two types define `status` differently, which
   fields are required. One type plus freeform tags covers the same retrieval needs without that
   ambiguity. The migration path is `typeId` → `typeIds` with property values namespaced by field
   id; it is additive when it arrives.

2. **Typed relations are the only semantic links.** A relation field is a typed view over relation
   records, not a duplicated array of card ids in a property. Two stores would drift, and backlinks
   would need reconciliation. Backlinks are always derived from the relation store.

3. **Sections derive membership from geometry and never write card state.** A section is a rectangle
   on a board; membership is computed from placement geometry at read time. Dragging a card into a
   section changes nothing about the card. Overlap resolves deterministically: topmost section by
   `z`, then smallest area, so a card belongs to at most one section. "Apply section as tags" (or as
   a property) is an **explicit, idempotent command** that writes tags once and reports what it
   changed. There is no live projection loop.

4. **Views are read-only saved queries.** A view answers a question; it does not own its results.
   Changing a card may change what a view shows, but a view never writes to a card. "Apply view
   result as tags/placements" is an explicit command, like section application. This is the
   Semantic Canvas lesson: projection is a deliberate act, not a side effect of layout.

5. **Links are statements; board context is a placement.** "A references B" is workspace truth.
   "A is wired to B on the Research board with a curved arrow" is a drawing. The same relation can be
   drawn on several boards, or on none. Today this distinction is collapsed into `edges`; the target
   model separates it.

6. **Derived facts are never persisted as authority.** Home, section membership, view results,
   backlinks and display titles are computed. A stored copy is a cache with an invalidation problem
   waiting to happen.

7. **Trash is workspace-level; unplace is board-level.** Delete/Backspace removes a placement.
   Trashing a card hides it everywhere and keeps its placements and content for restore. This is
   already the behavior in [ADR-0010](./decisions/0010-workspace-boards-and-cards.md) and every new
   surface must preserve it.

8. **Templates instantiate; they do not link.** A card created from a template has no runtime
   dependency on it. Editing the template later does not rewrite existing cards. This keeps template
   changes unsurprising and avoids another graph relationship to reconcile.

9. **No implicit cross-record writes.** One user action writes the smallest set of fields it
   changes. Bulk operations (apply section, move view results) are explicit commands with a visible
   effect, not consequences of moving a pointer.

## 6. Shell and UX model

The shell is canvas-first with retrieval always one gesture away. It stays out of the canvas's way
rather than surrounding it with chrome.

- **Library dock** *(current)*: a floating bottom-centre pill with Inbox count and a type menu —
  how you find objects that are not in front of you and how you create new ones.
- **Drawer** *(current)*: `Inbox | Cards | Trash`, counts, hold-to-place gesture, and type/tag
  facets with counts (OR within a facet, AND across). The target adds saved views without turning
  it into a sidebar.
- **Board tabs** *(current)*: switch boards inside the same workspace; switching tabs must never
  feel like switching documents.
- **Canvas toolbar** *(target)*: contextual tools for select, section and connect, in the spirit of
  Heptabase's floating palette. Creation stays in the dock; tools stay near the canvas.
- **Sections** *(target)*: drawn regions with titles and colors, rendered beneath cards. They are the
  spatial equivalent of a tag, but derived rather than written.
- **Sub-boards** *(later)*: a card can open into a nested board. This is navigation, not ownership:
  the nested board is another board in the same workspace and its contents remain ordinary cards.
- **Inspector / card info** *(current, growing)*: a floating right panel with type, tags, field
  values and placement references. Relations and backlinks join it in the next phase.
- **Backlinks** *(target)*: derived from relations, split into incoming and outgoing, naming the
  board(s) where each relation is drawn; clicking one navigates to the card.
- **Command palette** *(target)*: keyboard-first create, place, switch board, apply view/section,
  open card. Capture speed matters more than menu completeness.
- **Type dashboards** *(target)*: for a type, a derived table/list of all cards of that type with
  its fields as columns and its views as saved presentations. No board required.
- **Self-organizing views** *(target)*: views grouped by type, tag, field value or relation, pinned
  to a board as a panel or standalone in the library. Dragging a row never mutates the card unless
  an apply command is used.

**Interaction principles:**

- Selection and view state are UI state (Zustand), never document state.
- Dragging persists on release; live positions ride ephemeral presence. This applies to cards, sections and
  link endpoints.
- Creation focuses the title, so a new card begins as writing rather than as configuration.
- Destructive operations name their scope and offer the non-destructive path first.

## 7. Collaboration and local-first model

### Truth and presence

- **Loro is the truth** *(current)*. Every client observes and mutates the document; the UI never
  keeps a writable copy.
- **Ephemeral stores are for gestures, not facts** *(current)*. Pointer, dragging, connector movement,
  link drags, selection and carets travel over Loro `EphemeralStore`; positions persist only on
  release.
- **Presence is scoped by room** *(current; one room per workspace)*. In the target, board presence
  lives in the index room and per-card carets live in the card-doc room. The client merges both into
  one presence model: who is on this board, who is in this card.
- **Gestures expire on their own** *(current)*. A dropped connection must not leave ghost drags;
  the TTL projection is the model to reuse in every new room.
- A card open in two boards shows the same editors and carets. Board context changes where a
  pointer is drawn, not whether two people can write together.

### Card-level sharing

Card-level sharing is a **core requirement**, not a later nice-to-have: "share this card like a
Notion page" must be possible without sharing the workspace.

This is the main reason the index/card-doc split is architectural rather than a performance tweak:

- The **card doc** is the unit of content ACL. A share grants access to one card room plus a
  projection of that card's index summary.
- The **index** remains workspace-private. It contains every card title and property, so handing it
  to an external viewer would leak the workspace. A share is served as a **redacted projection**:
  the shared card's summary, its body doc, and relation stubs pointing at other cards (title and
  type only if those cards are also shared, otherwise "private card").
- **Board sharing** *(open question)* is a different capability: either read-only access to a
  filtered index or a server-rendered board snapshot. It must not be implemented by sharing the
  whole index.
- **Auth is per room.** The Loro sync server authenticates a connection for a room (workspace or
  card) and checks a capability. There is no document-level auth inside one doc; this is the
  decisive argument for separate rooms once sharing exists.

### Document boundaries and atomicity

Splitting documents buys isolated loading and ACL, and costs atomicity. There are no multi-document
transactions in Loro either, so every cross-document operation must be designed as a convergent
sequence:

- **Create card:** write the index summary first (possibly with `contentState: "pending"`), then
  create the card doc. Readers tolerate a missing body as empty. The reverse order would create
  unlistable orphan docs.
- **Trash:** index-only. The card doc is retained so restore is lossless.
- **Purge:** tombstone in the index first, then delete the card doc. A crash in between leaves an
  orphan doc, which a sweeper can remove; it never leaves a listed card with no body.
- **Undo is scoped.** Structural undo stays in the index; text undo stays in the card doc. There is
  no global undo across both, and the UI must not pretend there is. A single `Cmd-Z` walks the
  history of the surface that has focus.
- **Offline:** the index is always cached. Card docs are cached on open and pinned when edited
  offline; an unavailable card doc renders a read-only title/placeholder rather than blocking the
  board.

## 8. Performance strategy

Performance is a product feature: a thinking tool that stutters breaks the thought. The strategy is
**instrument first, take cheap wins, then split documents only when measurements demand it.**

### Budgets and metrics

| Metric | Target |
| --- | --- |
| Pan/zoom with ~200 visible cards | 60 fps, no long tasks over 50 ms |
| Drag input to painted movement | under one frame |
| Persisted CRDT writes during a gesture | zero (persist on release) |
| Warm board open (index cached) | under 100 ms to interactive |
| Card body open (doc loaded) | under 150 ms p95 |
| Index document size | ~1 KB per card summary; alarm at 10 MB |
| Card document size | p95 under 200 KB |
| Ephemeral presence traffic | bounded ~25–40 Hz per gesture, no document writes |

Instrument: document size by map, update bytes per second, ephemeral bytes per second, snapshot
build time, materialized records per change, mounted editors, render counts per board, and long
tasks. Measurements are compared before and after each optimization, not estimated.

### Cheap wins first

1. **Viewport culling** of card nodes and their Tiptap editors; mount bodies only near the viewport.
2. **Lazy editors**: a card renders its title and a body preview until focused; mounting every
   editor is the dominant cost on a large board.
3. **Incremental snapshots**: reuse unchanged collections and records, as `snapshotMerge` already
   does; never rebuild the whole board view model per keystroke.
4. **Batch and throttle**: ephemeral presence at 25–40 Hz, CRDT writes on release, derived lists recomputed
   on structural change rather than per frame.
5. **Derived indexes**: compute section membership and view results from sorted geometry and
   predicate indexes, not by scanning every card on every frame.
6. **No high-frequency CRDT**: carets and drags are ephemeral presence; a text edit is a normal CRDT update,
   not a per-keystroke structural write.

### When to split documents

Split when the index no longer fits the "small, hot" profile or when a single card's body dominates
load time — not before. Signals: index update size or load time grows with total body content;
opening a board loads megabytes unrelated to it; one shared card's editing traffic reaches clients
that never open it.

The current Loro benchmark (`pnpm bench`) makes the signal concrete. At 5,000 cards, a full
workspace snapshot is ~12 MB and exports in ~25 ms; a split index is ~0.8 MB, exports in ~2 ms, and
one card body is ~0.8 KB. The split is not needed for a small workspace, but it is the difference
between a board open that scales with what is viewed and one that scales with the whole workspace.

### Document boundaries in Loro

Loro has no Yjs-style subdocs. It has one document per room and shallow snapshots for partial
loading, but shallow snapshots still carry upstream import and panic risks, so they are **not** the
production path for card bodies yet. Separate rooms are the simpler path for sharing and lazy
content: one room per card doc, authenticated independently, persisted independently, synced only
when opened. The cost is connection/room management, no cross-doc atomicity, and a merged presence
model. That cost is acceptable because the model already treats cards as independent objects.

**Decision:** keep production storage as one document for now. Land the instrumentation and cheap
wins; design the index/card seam so a split is a storage change, not a semantic rewrite. Run a
spike with hundreds of cards and real bodies before committing to separate rooms.

## 9. Publishing boundary

Publishing is an **export/projection pipeline**, not a mode of the editor.

```
workspace index + card docs
        │  read-only export
        ▼
PublishBundle { schemaVersion, generatedAt, types, cards, bodies, relations }
        │
        ▼
publishing app (routes, slugs, templates, navigation)
        ▼
static site or hosted site
```

Rules:

- The core exposes a deterministic, versioned bundle. Export is a pure read; it never mutates the
  workspace.
- **Routes, slugs, templates and navigation are not card properties.** They belong to a publication
  configuration in the publishing app. A card that moves between boards or changes type does not
  break its URL unexpectedly; a publication decides how to derive a URL from a title and how to
  handle collisions.
- Publication state (draft/published/unlisted) is a property of a **publication entry**, keyed by
  card id, not of the card itself. The same card can be published in two sites with different
  visibility.
- The publishing app reads types to pick layouts and to render fields, and relations to build
  navigation and backlinks. It must not need to understand placements or sections unless it chooses
  to render a board.
- A published site is a snapshot; edits require re-export. Live collaborative rendering is a
  different product and is out of scope for the core.
- Any future "publish this card" button is a convenience that creates a publication entry and runs
  the pipeline; it does not add `slug`, `template` or `route` fields to cards.

This boundary is the practical expression of the north star: the thinking model stays clean, and
every web concern lives where it belongs.

## 10. Core feature list

### Foundation

- Workspace with boards, cards, placements, Inbox and Trash *(current)*
- Rich-text title and body with collaborative carets *(current)*
- Connectors and typed links, dormant when an endpoint leaves *(current)*
- Layers, undo/redo split by scope, offline persistence, live sync *(current)*
- Library dock and drawer, hold-to-place *(current)*
- Card types, typed fields and field values *(current)*
- Freeform tags with workspace-level rename and library facets *(current)*
- Card inspector with type, tags, properties and placement references *(current)*

### Thinking tools

- Spatial **sections** with derived membership
- **Views/collections** as saved read-only queries
- **Relations** separated from **edge placements**
- Backlinks, type dashboards, templates, command palette
- Explicit "apply section/view as tags or properties" commands
- Later card kinds: journal, mindmap, PDF and other embeds

### Collaboration and scale

- **Card-level sharing** with per-card ACL and redacted index projection
- Index/card-document split, lazy card-doc loading
- Board-level sharing (pending [open question](#11-open-questions))
- Workspace-wide search over index summaries, body search on demand
- Performance budgets and instrumentation as a release gate
- Publishing bundle export and a separate publishing app

### Non-goals and anti-patterns

- **CMS in the core.** No routes, slugs, templates or site trees as card properties.
- **Board-owned cards.** A board is never the owner of content or existence.
- **A mandatory folder tree.** Organization is spatial, typed and queryable; hierarchy is optional
  navigation.
- **Live property writes on drag.** Sections and views project only through explicit commands.
- **Stored view results or section membership.** Derived, always.
- **Multiple supertags in v1.** Deliberately later, with a namespaced additive migration.
- **A two-level board → card document tree.** Boards stay views in the index; only card bodies are
  separate docs.
- **A plugin API before the object model stabilizes.** It would freeze the wrong abstractions.
- **Unbounded real-time collaboration over every body.** Load what is viewed; share what is shared.
- **Server-authoritative document state.** The server persists and authenticates; it does not own
  the truth.

## 11. Open questions

| Question | Current leaning | Why it is unresolved |
| --- | --- | --- |
| **Board-level sharing** | Read-only filtered index or a board snapshot room | Neither is free: filtered index risks metadata leaks, snapshots lose live collaboration. |
| **Exact metadata split** | Title, type, tags and scalars in the index; body in the card doc | Title is text; excerpts, attachments and embeds need a rule before migration. |
| **External share semantics** | Redacted projection + relation stubs | Need to define revocation, transitive visibility through relations, and whether a viewer can see titles of unshared neighbours. |
| **Search** | In-memory index over summaries first; body search loads card docs | A central search index conflicts with per-card ACL and local-first availability. |
| **Multiple supertags** | Additive `typeIds` with field-id-namespaced properties | Required fields, conflicting field kinds and dashboard ownership need a concrete rule. |
| **Cross-document transactions** | Compensating, idempotent sequences; scoped undo | Loro has no multi-doc transaction, and a transaction log would become a second truth. |
| **Section overlap and nesting** | Topmost-then-smallest wins; no nesting initially | Nesting multiplies ambiguity in "which section owns this card" and in apply commands. |
| **Edge placement multiplicity** | One drawing per (board, relation) | Multiple drawings of one statement may be legitimate but complicate selection and deletion. |
| **Card doc retention and purge** | Trash retains the doc; purge tombstones then deletes | Offline clients may resurrect a purged doc; needs a tombstone/GC rule. |
| **Offline availability of card docs** | Pin edited docs; evict others by LRU | Storage quotas and "why is this card blank offline" expectations are unresolved. |

Open questions are recorded here rather than resolved by implication. When one is decided, it should
become an ADR and this document should link to it.
