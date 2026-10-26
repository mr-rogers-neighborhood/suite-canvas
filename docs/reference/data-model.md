# Data model

This page does not cover how the canvas draws these records or how a share link is authenticated;
[architecture.md](architecture.md) and [security-model.md](security-model.md) own those. It describes the
records `@suite/graph` stores, the rules a write follows, and the two derived surfaces beside the document.

## One document, thirteen roots

A workspace is one `LoroDoc`. Everything the workspace owns is reachable from thirteen root containers, and
each root is a `LoroMap` keyed by record id.

| Root | Holds | Opened by |
| --- | --- | --- |
| `boards` | one map per board | `WorkspaceDocument.BOARDS_KEY` |
| `cards` | one map per card, without its text | `CARDS_KEY` |
| `placements` | one map per (board, card) pair | `PLACEMENTS_KEY` |
| `edges` | one map per link | `EDGES_KEY` |
| `types` | one map per card type and its field definitions | `TYPES_KEY` |
| `tags` | one map per tag | `TAGS_KEY` |
| `sections` | one map per section | `SECTIONS_KEY` |
| `content` | one map per card body, holding a rich-text tree | `CONTENT_KEY` |
| `titles` | one map per card title, holding a rich-text tree | `TITLES_KEY` |
| `references` | derived index of which cards a card mentions | `REFERENCES_KEY` |
| `meta` | workspace name, seeding flag, navigation board, shell paint, theme, style rules | `META_KEY` |
| `views` | one map per saved view | `VIEWS_KEY` |
| `drawings` | one scene per card | `WorkspaceDocument.drawingRoot(doc)` |

`STRUCT_KEYS` in `packages/graph/src/loro/keys.ts` names the first twelve. The drawings root is not in that
object: it is opened only through the facade, so no domain module can reach it without going past the typed
writer. `WorkspaceDocument.ROOT_KEYS` lists all thirteen in the order a projection replaces them.

The facade is `packages/graph/src/loro/WorkspaceDocument.ts`. Its card half is the `CardsFacade` class in
`packages/graph/src/loro/facade/cards.ts`, which the facade extends, so `doc.listCards()` and
`doc.titleId()` resolve on the same prototype as `doc.createBoard()`. Domain modules are plain functions
over a shared `DocContext` (`packages/graph/src/loro/context.ts`), composed by `createDocApi` in
`packages/graph/src/loro/api.ts`, and they call each other through `ctx.api`.

## Record shapes

`packages/graph/src/schema.ts` is the only description of a record. Every read parses through it, so a
malformed value throws at the boundary that read it rather than reaching the canvas.

| Record | Stored on the record map | Nested containers |
| --- | --- | --- |
| Board | `name`, `color`, `coverAttachmentId`, `template`, `style`, `createdAt`, `updatedAt` | `tags`, a map of tag id to `true` |
| Card | `createdAt`, `updatedAt`, `deletedAt`, `primaryTypeId`, `style` | `types`, `tags`, `properties`, `connectors` |
| Placement | `boardId`, `cardId`, `x`, `y`, `z`, `createdAt`, `width`, `height` | none |
| Section | `boardId`, `title`, `x`, `y`, `width`, `height`, `z`, `color`, `style`, `createdAt`, `updatedAt` | `tags`, `connectors` |
| Edge | `boardId`, `source`, `target`, `sourceKind`, `targetKind`, `sourceConnector`, `targetConnector`, `kind`, `path`, `bidirectional`, `label`, `labelOffset`, `bends`, `layer`, `style`, `createdAt`, `updatedAt` | none |
| Card type | `name`, `pluralName`, `glyph`, `color`, `templateCardId`, `createdAt`, `updatedAt` | `fields`, a map keyed by field id |
| Tag | `name`, `color`, `createdAt` | none |
| Saved view | `name`, `position` | `query`, a map holding the query facets |

A placement is keyed by `placementKey(boardId, cardId)` from `packages/graph/src/loro/constants.ts`, which
is `${boardId}/${cardId}`. One card can therefore sit on many boards without a second record kind.

`z` is a fractional number. A reorder writes the one placement that moved instead of renumbering the stack,
and `MIN_RANK_GAP` is the distance below which the board renumbers.

`deletedAt` is a number on a card and a drawing element, null or absent everywhere else. It is the soft
delete, not a second record.

Readers live in `packages/graph/src/records/`. `cardFromMap` is the one card reader, `normalizeCard`
backfills a field added after a document was created, and `readIdSet` turns an id-keyed map into the array a
caller expects.

## How a write behaves

A write touches the leaf that changed. `setBoardColor` sets the `color` key of one board map, so a peer
renaming the same board concurrently keeps both edits.

Membership is a map rather than an array for the same reason. A card's `tags` is a map of tag id to `true`,
so two peers adding different tags both survive the merge, and `applyCard` diffs that map instead of
replacing it.

`setCard` and `setEdge` are whole-record writes, and the code says so: `setCard` is documented as a full
write whose field-level alternatives are beside it. `applyCard` rewrites every leaf and stamps `updatedAt`,
so a stale copy republished through it reverts a concurrent rename even when the sets merge cleanly. Anything
a person can edit while another person is editing it goes through `mutateCard(cardId, (fields) => ...)`,
which writes one leaf and commits under a `struct:` origin.

A read never creates shared state. `peekContent` and `peekTitle` return `null` for a card with no container,
and only `getContent` and `getTitle` create one. A viewer mounting an editor for a card it cannot write must
use the peek pair, or every peer's document grows a container nobody authored.

Every mutation commits once. `ctx.batch(origin, fn)` coalesces a gesture into one commit, `ctx.commit`
appends when no batch is open, and the snapshot layer sees one change per gesture rather than one per leaf.

## Text containers

A card's title and body are separate roots, each holding one `LoroMap` per card. Inside that map a
`children` `LoroList` mirrors the editor's node tree, and every text leaf is a `LoroText`. The publish
snapshot calls such a leaf `$text`.

The split is the field granularity rule: renaming a card does not touch its body, so a peer typing in the
body while another renames the card merges both edits.

Origins decide which undo stack an edit lands in. `TEXT_ORIGIN_PREFIX` (`loroSyncPlugin`) and
`BODY_BLOCK_ORIGIN` (`text:body`) belong to the editors. `struct:` prefixes belong to the facade.
`INDEX_ORIGIN` (`struct:index-refs`) is excluded from both, because the reference index is rebuilt from
content and an undo would make it disagree with the text it describes.

## The reference index

`references` is derived: for each card, a map of the card ids its title, body and property values name.
`packages/graph/src/loro/cards/references.ts` owns it.

`ensureReferences` compares the stored set with the set the text currently names and rewrites only the
entries that differ, so running it on every client after the first sync converges without coordination.
`rebuildReferences` rewrites every entry and drops entries for cards that are gone. Text changes schedule
the index through `scheduleReferences`, and the subscriber in `context.ts` skips its own writes by origin so
an index write cannot schedule another one.

The index is a query surface, not a truth: a caller that wants what the text says asks `contentTargets`.

## Queries and caches

Reads are methods on the facade: `listBoards`, `listBoardCards`, `listInboxCards`, `listCardsOfType`,
`listCardsWithTag`, `listLinksTo`, `referencesFor`, `listViews`. Each one reads the document maps and parses
through the schema.

`DocContext` holds a cache per record kind (`cardCache`, `boardCache`, `edgeCache`, and the rest) plus the
container and reference caches. The subscription in `context.ts` invalidates the exact keys a commit touched
and notifies the listeners that asked about them, which is why a cache is never the authority for what a
document contains. A cache cannot be written to make a read faster in a way that changes an answer.

Saved views store a query, never a result. `viewQuerySchema` in `packages/graph/src/views.ts` holds text
facets, type and tag facets, scope, grouping and predicates, and `viewPredicates.ts` evaluates them against
the document at read time. `viewsRevision` moves when a view record changes, so a renderer can subscribe to
the view list without subscribing to every card.

## Publish: plan, then apply

A share editor never writes the owner's document. It edits a draft, and publishing copies the captured
values onto the source in one commit.

`packages/graph/src/publish/` owns both halves. `planPublish` is pure: it compares the draft, the baseline
and the source, records `changes`, `conflicts` and `unsupported` keys, and captures the exact value of each
change. `applyPublish` refuses a plan with a conflict or an unsupported key, then replays the captured
values inside `source.batch(PUBLISH_ORIGIN, ...)`.

Apply does not validate. `packages/graph/src/publishValidation.ts` is the validator, and planning is the only
place that calls it. Apply's guards are replay guards, so a plan applied twice writes nothing the second
time, and each step compares before writing for that reason. `publish/apply.ts` keeps one named function per
change kind, so the replay rule for each kind can be read on its own.

The caps a plan enforces are in [limits.md](limits.md): bytes per card text, bytes per draft, coordinate
range, rich-text nesting and a fixed allowlist of node and mark names.

## Projection: a second document per share

A board, card or selection share reads a projection, which is a fresh `LoroDoc` built from the owner's
document. `projectWorkspace` in `packages/graph/src/projection/workspace.ts` copies the board, the selected
cards, their placements, their sections and the edges whose ends both travel, then commits once under
`sys:projection`.

Nothing outside the selected scope is copied, so the projection cannot leak a record the share does not
cover. A reference to a card that stayed behind is reported with `private: true` instead of being copied, and
a board share replaces the title with `PRIVATE_REFERENCE_TITLE`. The relay keeps one such document per open
share room, and `apps/collab-server/src/projection/` rebuilds it when the owner's copy changes.

## Files, backups and merge

`packages/graph/src/workspaceFile.ts` wraps a document in the `.suite` envelope (`suite.workspace`, version
2, which added attachments). `packages/graph/src/portable.ts` exports a document as plain JSON
(`suite.portable`, version 1) for interchange, and `merge.ts` merges a portable export into a document.

`SCHEMA_VERSION` is 4. It is the version of the document shape the code expects, not the version of the
`.suite` envelope, which carries its own number.

## Where the schema lives

The chain for any record change is the same, and [../how-to/change-the-data-model.md](../how-to/change-the-data-model.md)
walks it with the tests each step needs.

1. `packages/graph/src/schema.ts` describes the record.
2. `packages/graph/src/records/` reads it back, including a backfill for a field older documents lack.
3. `packages/graph/src/loro/` writes it, one leaf at a time.
4. `packages/graph/src/loro/api.ts` composes the domain module, and `WorkspaceDocument.ts` or
   `facade/cards.ts` exposes the method.
5. `packages/graph/src/index.ts` re-exports the type a consumer outside the package needs.

A schema bump is a decision, not a side effect of adding a field: older clients keep editing the same
document, so a field that changes meaning needs a backfill that reads both shapes.
