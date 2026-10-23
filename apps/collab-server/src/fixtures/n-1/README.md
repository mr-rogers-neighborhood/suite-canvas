# N−1 store fixtures

These files are committed inputs for `src/storeUpgrade.test.ts` (gate A7). Each
one is opened by the test, the current boot path runs against it, and the test
asserts the rows survive.

## What "N−1" means here, honestly

The repository has no tags and no releases, so **no fixture here was written by
an older build of the program**. A true N−1 binary cannot be produced without
inventing history. What each file carries is an older *shape* — the columns the
migrations in `shares.ts`, `settings.ts` and `workspaceHttp.ts` were written for,
a snapshot blob from before the `loro-snapshot-v1` tag, or no file at all where
the store did not exist. The test states this in its own comment so the limit is
not mistaken for a stronger claim.

Where a store never had an older shape, the file is current-shaped and is kept
as a baseline for the *next* bump:

| Fixture | Shape it represents | Prior shape? |
| --- | --- | --- |
| `documents.sqlite` | `documents` with untagged Loro snapshot blobs, `PRAGMA user_version = 0` | Yes — pre-format-tag |
| `documents-newer.sqlite` | `documents` with `user_version = 99` | Negative case: must be refused |
| `shares.sqlite` | `shares` without `room_id`, `expires_at`, `card_ids`, `last_used_at` | Yes — the shape `migrateShareColumns` predates |
| `workspaces.sqlite` | current shape | No migration has ever run on this table |
| `settings.sqlite` | `settings(key, value)` without `updated_at` | Yes — `migrateSettingsColumns` |
| `licences.sqlite` | `workspace_licences` without `quota_json`, `email`, `expires_at` | Yes — `migrateLicenceColumns` |
| `attachments.sqlite` | **absent** | The store is new; a fresh file must open empty |

The `.sqlite` files are committed with `git add -f`: `.gitignore` excludes
`*.sqlite` everywhere (rightly — a runtime store must never be committed), and
these are test *inputs*, not runtime data. Regenerating them is a deliberate act.

## How each file was produced

Run from `apps/collab-server` with the workspace dependencies installed
(`generate-n1-fixtures.mts` is the generator; it is not part of the build):

```sh
NODE_OPTIONS=--conditions=development ./node_modules/.bin/tsx src/fixtures/n-1/generate.mts
```

It writes every fixture above into this directory. The document fixture is a
real Loro document — a board, two cards with titles, and
`meta.schemaVersion = 3` (the previous value of `SCHEMA_VERSION`) — exported
with `doc.export({ mode: "snapshot" })` and stored **without** the
`loro-snapshot-v1` prefix, which is exactly what the previous build wrote.

## Verification expectations

- The old blob imports, the board and both cards are present, and no stored
  bytes are rewritten on read (`PRAGMA user_version` is stamped to the current
  store version; the blob stays untagged until the next save).
- `shares` gains its newer columns and `room_id` is backfilled from
  `workspace_id`; the baseline bytes are unchanged.
- `settings` and `licences` gain their newer columns and keep their rows.
- A `user_version` above the current store version throws
  `UnsupportedStoreVersionError`. Nothing is opened "best effort".

## Policy

- A schema bump is an explicit commit: the new DDL, its migration, a fixture
  here, and a change to `DOCUMENT_STORE_SCHEMA` or `SNAPSHOT_FORMAT_TAG`.
- A store or blob written by a newer build refuses to open with a message naming
  both versions. There is no best-effort read and no downgrade path.
- No silent backfill: reading never rewrites document bytes, and a column that
  has to be derived is derived by the explicit migration that documents it.
