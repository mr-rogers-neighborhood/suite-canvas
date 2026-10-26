# Design direction

Suite is a local-first canvas over a workspace of typed cards. One Loro document holds the whole workspace, the browser edits it offline, and a relay syncs it when one is reachable. A card exists on its own, and a board is a context that shows some of those cards at chosen positions.

Two rules decide most questions here. The document is the only source of truth, and anything that can be recomputed from it is not stored.

## The document

`WorkspaceDocument` in `packages/graph/src/loro/` wraps a single `LoroDoc`. Inside it, `cards`, `boards`, `placements`, `sections`, `types`, `tags`, `edges`, `views` and the per-card `titles` and `content` containers are Loro maps, keyed by id. Loro merges concurrent edits, and every write goes through a Zod-validated method on that wrapper, so no component touches raw CRDT calls.

Field granularity is what makes that merge useful. A property write sets one key in `card.properties`, a section move writes `x` and `y`, a tag add writes one key. A whole-record write would turn every unrelated concurrent edit into a last-write-wins conflict that nobody sees happen.

Stored facts are the ones a reader authored: identity, types, property values, tags, body text, placement geometry, board and section names, style rules. Everything else is derived at read time. Home board, section membership, display titles, reference counts, view results and share projections are computed from those facts, and a stored copy would be a cache with an invalidation problem (ADR-0012, ADR-0019).

Presence is separate from the document. Pointer, drag, marquee and connector movement travel over Loro `EphemeralStore` channels with a time to live, so a dropped connection cannot leave a ghost drag. A position is persisted on release, which is the moment the reader has decided (ADR-0005, ADR-0009).

## Projections

A projection is a read: a function from document state to something a surface draws, with no write back. The board face is a projection of placements through the placement and section code. The outline rail is a projection of section containment. `referencesFor` is a projection of mention nodes and card-valued fields. A share link serves a projection built from an allowlist, so the index of every title stays private (ADR-0022, ADR-0023).

A projection may be cached only if it can be thrown away and rebuilt from the document. The reference index qualifies because it is recomputed from content. View results do not qualify and are not stored.

A projection that changes something is an explicit command with a name and a report of what it touched. Promoting a selection into a view, applying a section as tags, publishing a card: each is idempotent and reports its changes. Nothing runs a loop that rewrites cards because layout moved.

Splitting the workspace into one index document plus a document per card would buy isolated loading and per-card access control, and it would cost cross-document atomicity. Loro has no multi-document transaction, so creation order, trash retention and purge tombstones become a convergent sequence, and undo splits by scope. The split waits for a benchmark that asks for it and stays behind the `WorkspaceDocument` seam until then (ADR-0065).

## What is settled

| Question | Decision | Record |
| --- | --- | --- |
| Where truth lives | One Loro document per workspace, observed and mutated by clients; the relay persists and authenticates | ADR-0015, ADR-0020 |
| What a board is | A named context showing placements of cards it does not own; removing from a board is not deleting | ADR-0010, ADR-0040 |
| How a card is classified | One primary type plus supertags, with the other types unioning their fields | ADR-0053 |
| How cards relate | References derived from `@` mentions and card-valued fields; edges carry no data | ADR-0019, ADR-0062 |
| How a section is defined | A named region whose membership is the smallest containing header anchor | ADR-0017 |
| How sharing works | A live projection room over a redacted, self-contained copy, scoped to a board or a selection | ADR-0022, ADR-0023 |
| What owns the shell's colour | Style rules stored in the document and resolved through the contrast floor; the shell never holds a palette | ADR-0046, ADR-0071 |
| How many inspectors | One panel driven by the selection, opened from the canvas or a library row | ADR-0050 |
| What a template is | A creation recipe duplicated on use; a type blueprint is itself a card | ADR-0038, ADR-0059 |
| What a tutorial is | A card whose body holds tour steps, presentable on the canvas | ADR-0054 |
| Which field kinds compose | `rating`, `group` and `list` compose from the built-in kinds | ADR-0057 |

## What is not settled

| Question | Where it stands |
| --- | --- |
| Document split | Waiting on a benchmark: one index document plus per-card documents, with the crash and undo costs above |
| External share semantics | Revocation, transitive visibility and whether a viewer sees the titles of unshared neighbours |
| Search | An in-memory index over summaries first; body search would load card documents, because a central index conflicts with per-card access and offline use |
| Card document retention | Trash retains content and purge tombstones first, while an offline client may still resurrect a purged record |
| Publishing | Routes, slugs and navigation belong to a publication that reads a deterministic bundle; no such surface ships |

## Judging a proposal

Four questions settle most of them.

- Which word in the [glossary](../reference/glossary.md) does this change, and does it stay inside that word's scope?
- Is the new value stored, or can it be recomputed from what is already stored?
- What happens when two clients write at once: does the write land on a leaf field, or replace a record?
- Does it survive offline use, or does it need a round trip before the reader sees the result?

A proposal that cannot answer the second and third is not a design yet. The layer map, the data flow and the record shapes are in [reference/architecture.md](../reference/architecture.md); the editing surfaces are in [reference/editing.md](../reference/editing.md) and [reference/ui.md](../reference/ui.md).
