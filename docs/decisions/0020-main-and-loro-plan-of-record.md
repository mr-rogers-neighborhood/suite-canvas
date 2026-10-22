# ADR-0020: Main and Loro are the plan of record

- **Status:** accepted
- **Date:** 2026-10-22
- **Supersedes:** the October 20 "from a blank page" memo (kept as history, not instructions)

## Context

The October 20 memo proposed a hard fork: a new `next` branch starting from an empty tree, Yjs and
Hocuspocus, one note object, and no types, fields, tags or sections. That work was not started.
Instead, `main` continued, migrated the sync stack from Yjs to Loro
([ADR-0015](./0015-loro-as-crdt-engine.md)), and added the semantic surfaces the memo excluded:
typed cards, fields, properties, tags, sections, references, mentions, property blocks, display
templates and multi-object selection. Local `main` is 33 commits ahead of `origin/main`, and the
only other branch, `pivot/loro`, is an ancestor of `main`.

Planning against the memo would therefore plan a product that no longer exists. At the same time,
the current branch has real gaps: a workspace cannot be exported or imported, card-level sharing is
not implemented, some in-flight surfaces are under-tested, and the editor's block styles are lost to
Tailwind Preflight (headings render at body size, lists lose their markers).

## Decision

1. **`main` and Loro are the plan of record.** The Yjs memo is archived as history. `origin/main`
   is brought up to date; `pivot/loro` is removed after verifying it is an ancestor.
2. **Cards are objects; boards are contexts.** The typed graph stays. This phase finishes the
   existing surfaces before widening the model.
3. **One type per card.** Multi-type membership is not added: it makes field ownership, required
   fields, validation and future dashboards ambiguous, while tags already provide cross-cutting
   grouping. The stored `types` map remains a one-key map for merge safety; no schema migration is
   made in this phase.
4. **Finish, then own the data.** The order is: editor/block rendering, one shared value formatter,
   property blocks, field-kind robustness, library polish, onboarding/share, exact backup and
   restore, portable export. Exact backup is the only import path; portable JSON/Markdown is
   export-only.
5. **Card-level sharing is deferred, not faked.** It requires separate card rooms, a redacted index
   projection and per-room auth. The seam is recorded; the share affordance states that anyone with
   the link can edit.
6. **Every field kind has a contract.** Storage shape, validation, empty state, display, concurrency
   and tests are written down and shared by the panel, card face, property block, mention chip and
   export.

## Consequences

- No new branch and no rewrite; the 30k-line tree remains the product.
- The old memo's vocabulary (`note`, `link`) is not adopted. The repository's vocabulary (`card`,
  `board`, `type`, `section`, `reference`) is the one in the docs.
- Multi-type storage remains but is not exposed. A future cleanup may collapse it to `typeId` if the
  smaller code earns a migration.
- Card-level sharing remains a named future project rather than an implied capability.
- The plan's phases and acceptance criteria live in the session plan; the repository docs record
  the durable decisions.
