# Attachments drill — 20261026T145946Z

- Result: **passed**
- Host: `Linux 7.2.9-arch1-1 x86_64`, Docker 29.9.0
- Project: `suite-drill`, restore project: `suite-drill-restore`
- Volume: `suite-drill_suite-data`
- Workspace: `drill-20261026T145946Z`
- Image: `suite-drill-baseline:local` (see the last note: the checkout's own build could not start)

`id bytes sha256` per attachment, read back through the deployed API:

```
before recreate      after recreate       after restore
0000000000000000000000006adf6ae5 24576 e14c6869ff3e835c8c198bb4a1b6e31aea18a8bcbedb0b2616fff87f2e49b9f1  |  0000000000000000000000006adf6ae5 24576 e14c6869ff3e835c8c198bb4a1b6e31aea18a8bcbedb0b2616fff87f2e49b9f1  |  0000000000000000000000006adf6ae5 24576 e14c6869ff3e835c8c198bb4a1b6e31aea18a8bcbedb0b2616fff87f2e49b9f1
0000000000000000000000006adf89d4 7168 ed4a245960b361b468e12cbd9e1b268d4fc6503978e1c0c2135548f0ee061b63  |  0000000000000000000000006adf89d4 7168 ed4a245960b361b468e12cbd9e1b268d4fc6503978e1c0c2135548f0ee061b63  |  0000000000000000000000006adf89d4 7168 ed4a245960b361b468e12cbd9e1b268d4fc6503978e1c0c2135548f0ee061b63
```

Two ids with different lengths, because one row that happens to be right proves
nothing: every id resolves to the same length *and* the same bytes after a
container recreate and after a restore.

The workspace document, opened by the restored app through `/api/admin/workspaces/<id>`:

| Step | Observed |
| --- | --- |
| Seeded into the document store, opened | `WORKSPACE boards=1 cards=1 bytes=2548` |
| After `up -d --force-recreate app` | `WORKSPACE boards=1 cards=1 bytes=2548` |
| After backup and restore | `WORKSPACE boards=1 cards=1 bytes=2548` |

Timed restore over the live restored stack (stop → replace six stores → start →
`/health`), same snapshot, 132 KB on disk:

| Segment | Observed |
| --- | --- |
| Whole `deploy/restore.sh --force` run | 2 192 ms |
| Health answer | `{"ok":true}` |

Manifest excerpt (host paths replaced with `<drill-dir>`):

```
file	name	source	bytes	sha256
file	documents	<drill-dir>/volume/documents.sqlite	16384	3b07a67f3c893f5919f8fff85b9f9d0cb559337d14d29a09ee8a7dc32337bdb1
file	shares	<drill-dir>/volume/shares.sqlite	40960	d8d6d5574872b63af53c5a2421a2f85dc13b5629272ff7f390e5ebee4268ac30
file	workspaces	<drill-dir>/volume/workspaces.sqlite	16384	c74a359a6fcd0a41de534a1d50dd4f1ce4849822e03be1a2452d75105ffc2acf
file	settings	<drill-dir>/volume/settings.sqlite	12288	681d972971a566472eeedfb536fc0be606a32a5db0740de4a9279edc4d904ef5
file	licences	<drill-dir>/volume/licences.sqlite	missing	-
file	attachments	<drill-dir>/volume/attachments.sqlite	45056	de08be39022c9a69cc962b57ee2989df97a69f3788efd8de2c1450516fb804dc
counts	table	rows	bytes
counts	documents	1	2548
counts	share_projection_documents	0	0
counts	shares	0	-
counts	share_baselines	0	0
counts	workspaces	1	-
counts	settings	0	-
counts	attachments	2	31744
attachment_ids	sha256	c83540edeea00456093d33c04f0f1e61f52caa5ce462882b9a0aa30aa7afd226
```

Notes and limitations:

- All six stores are in the manifest with sizes and SHA-256. The settings store
  is present (12 288 bytes); its `settings` table is empty because this drill
  changes no limits, and a deployment with overrides records a row count there.
- `licences` is `missing` on a self-host that never claimed one: the file is
  created on the first claim, so there is nothing to snapshot yet. A restore
  warns and leaves that store alone instead of inventing an empty database.
- The drill seeds one document row straight into the document store (one board,
  one card) and then asks the running app to open it through
  `/api/admin/workspaces/<id>`, which imports the snapshot and counts what it
  holds. That proves the restored bytes load, not that a browser can join a room:
  the socket join from a real canvas is still a manual step on a real
  deployment.
- The image is `suite-drill-baseline:local`, built from commit `fd6b25a`. The
  checkout's own build completed but its `app` container could not start —
  `ERR_MODULE_NOT_FOUND: @suite/licence` — because that workspace package was
  being moved while this drill ran. The parts this drill is evidence for are
  `deploy/backup.sh`, `deploy/restore.sh` and the six `/data` paths, all of which
  came from the working tree; re-run the drill without `--skip-build` once the
  image builds and starts, and replace this record.
- This is a self-host drill: no licence claim, no `SUITE_HOSTED`, one workspace.

The previous record (20261023T085428Z) covered one attachment and no document
row; this run covers two ids, the restored workspace opening, and a measured
restore.
