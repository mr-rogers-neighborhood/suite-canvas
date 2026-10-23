# Attachments drill — 20261023T085428Z

- Result: **passed**
- Host: `Linux 7.2.9-arch1-1 x86_64`, Docker 29.9.0
- Project: `suite-drill`, restore project: `suite-drill-restore`
- Volume: `suite-drill_suite-data`
- Workspace: `drill-20261023T085428Z`, attachment: `0000000000000000000000006adb20c7`

| Step | Observed |
| --- | --- |
| Upload, read back | `e14c6869ff3e835c8c198bb4a1b6e31aea18a8bcbedb0b2616fff87f2e49b9f1` |
| After `up -d --force-recreate app` | `e14c6869ff3e835c8c198bb4a1b6e31aea18a8bcbedb0b2616fff87f2e49b9f1` |
| After backup and restore into `suite-drill-restore_suite-data` | `e14c6869ff3e835c8c198bb4a1b6e31aea18a8bcbedb0b2616fff87f2e49b9f1` |

Manifest excerpt (host paths replaced with `<drill-dir>`):

```
file	name	source	bytes	sha256
file	documents	<drill-dir>/volume/documents.sqlite	12288	18279fd8f160073dbc90fcfa9fa0624f8780bf474927dab000bffee0d91a8a58
file	shares	<drill-dir>/volume/shares.sqlite	40960	d8d6d5574872b63af53c5a2421a2f85dc13b5629272ff7f390e5ebee4268ac30
file	workspaces	<drill-dir>/volume/workspaces.sqlite	16384	f0890d7a9547143b7218b02b7636f646299a0aa04d2f4750d0cfc07e0ff45d70
file	settings	<drill-dir>/volume/settings.sqlite	12288	681d972971a566472eeedfb536fc0be606a32a5db0740de4a9279edc4d904ef5
file	licences	<drill-dir>/volume/licences.sqlite	missing	-
file	attachments	<drill-dir>/volume/attachments.sqlite	40960	35a0a1d914c35e0db797bdf9400df3c06b2bb6d0440077c466f7f68a93e3de62
counts	table	rows	bytes
counts	documents	0	0
counts	share_projection_documents	0	0
counts	shares	0	-
counts	share_baselines	0	0
counts	workspaces	1	-
counts	settings	0	-
counts	attachments	1	24576
attachment_ids	sha256	bbb1ec8a87ac855cf065ac9c9afc89078908fbe3ec63c20a541ac5cabf646c6f
```

Notes and limitations:

- The drill never opens a document room, so `documents` is 0 by construction:
  the state it exercises is the workspace claim and the attachment bytes. The
  document store's own durability (reopen the same file, identical bytes) is
  covered by `apps/collab-server/src/attachmentDurability.test.ts` and
  `pnpm test`.
- `licences` is `missing` on a self-host that never claimed one: the file is
  created on the first claim, so there is nothing to snapshot yet. A restore
  warns and leaves that store alone instead of inventing an empty database.
- "Open the workspace" here means the restored `app` starts on the scratch
  volume, answers `/health`, and serves the same attachment bytes through its
  own API. A browser opening the canvas is a manual step on a real deployment.
