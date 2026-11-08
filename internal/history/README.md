# Archive

Everything under `docs/archive/` is **history, not current truth**. It is kept because a record of
what was decided, promised or believed at a point in time is worth more than a tidy tree: a reader
can see the road not taken, and a writer can check whether an argument was already had.

## What the archive promises

- **It is exempt from current-truth checks.** `scripts/docs-check.mjs` treats `docs/archive/` (like
  `docs/decisions/`) as historical, so a retired name, a superseded version or an abandoned design is
  correct there, not drift.
- **It is not exempt from link checks.** A link in an archived page must still resolve, because a
  dead link is a dead end rather than a record. If a target moved, fix the link in place; do not add
  a redirect table.
- **It is not rewritten.** Do not edit an archived page to match today. If it turns out to be right,
  write a current page and link back here as the source.

## What goes where

| Path | Holds |
| --- | --- |
| `roadmap/` | The alpha, beta and v1/v2 programme documents, with their drift ledgers |
| `decisions/` | Every full decision record: accepted, superseded, and the long version of the records that are still open |
| `design-inspirations.md` | The pre-restructure design reference |

The terse records that are still live are in [`../docs/explanation/decisions/open/`](../docs/explanation/decisions/open), and one row
per record is in [`../explanation/decisions.md`](../docs/explanation/decisions.md). An accepted decision is
now archived when it is accepted, not only when it is superseded: the outcome lives in
[`../reference/architecture.md`](../docs/reference/architecture.md), and this is the argument behind it.

New material never starts here. It is written as a current page in the Diátaxis tree
(see [the documentation map](../docs/README.md)) and only ever arrives in the archive by being replaced.
