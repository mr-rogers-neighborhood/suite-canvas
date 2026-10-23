# Deployment drills

A drill is a scripted, repeatable exercise of a claim the roadmap makes about the
deployment. It is not a unit test: it runs the composed stack, and its output is
kept as a record.

| Drill | Gate | What it proves |
| --- | --- | --- |
| [`attachments.sh`](./attachments.sh) | A1 | Attachment bytes survive a container recreate, a backup, and a restore into a scratch volume. |

## Running one

```sh
deploy/drills/attachments.sh                      # builds the image, runs, cleans up
deploy/drills/attachments.sh --skip-build          # reuse the image built for this checkout
deploy/drills/attachments.sh --keep                # leave containers, volumes and artifacts
deploy/drills/attachments.sh --record <file.md>    # also write a filled-in record
```

Each drill runs under its own compose project (`suite-drill`, `suite-drill-restore`),
so it never touches the `suite` project, its containers or its volumes. Artifacts
(snapshot, manifest, copied volume) default to `.scratch/drills/<drill>-<stamp>`,
which is git-ignored; override with `SUITE_DRILL_DIR` to keep a run somewhere
durable.

Exit codes: `0` passed, `1` a step failed, `3` Docker is unavailable.

## Record template

Copy this into a record file (or pass `--record`) and fill it in from the run.
A drill without a record is an assertion, not evidence.

```markdown
# <Drill> drill — <UTC timestamp>

- Result: **passed** | **failed** | **not run (reason)**
- Commit: `<git rev-parse HEAD>`
- Host: `<uname -srm>`, Docker `<version>`
- Projects: `<live project>`, `<restore project>`
- Volume: `<volume name>`
- Artifacts: `<path to snapshot and manifest>`

| Step | Observed |
| --- | --- |
| <first observation> | `<value>` |
| <after recreate> | `<value>` |
| <after restore> | `<value>` |

Manifest excerpt:

```
<the counts, attachment_ids and file lines from manifest.txt>
```

Notes and limitations:

- <anything the drill could not prove here, stated plainly>
```

## When Docker is unavailable

Record the limitation instead of a transcript, name the command that was not run,
and cite what still holds without a container:

- `pnpm vitest run --project=server apps/collab-server/src/attachmentDurability.test.ts`
  — the store reopens the same file and returns identical bytes; compose points
  all six stores at `/data`.
- `deploy/backup.sh` + `deploy/restore.sh <snapshot> --verify-only` — the
  manifest, per-table row counts, attachment id checksum and every integrity
  check, with no container involved.

Do not claim A1 from the unit tests alone: the bug was a deployment fact, and only
the composed stack can prove the deployment fixed it.

## Records

- [`attachments-record.md`](./attachments-record.md) — the most recent passing
  run of the attachments drill.
