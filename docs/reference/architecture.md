# Architecture

Canvas is two processes and two packages. The renderer is a web app; the shell is Electron and owns
the file. Nothing in either reaches a network.

| Piece | Path | What it decides |
| --- | --- | --- |
| Renderer | `apps/canvas` | The document's UI: launcher, boards, cards, editor, panels |
| Shell | `apps/desktop` | The file on disk, its lock and backups, the window, the package |
| Document | `packages/graph` (`@suite/graph`) | The schema and the only writer |
| Importer | `packages/import-obsidian` | Reads a vault into a document |

## The document

One Loro CRDT document per workspace, validated by Zod on every write. `@suite/graph` owns both the
schema and `WorkspaceDocument`, the wrapper that applies a change and emits typed events; raw CRDT
access outside it is prohibited. That is what keeps an invalid document unrepresentable, and a schema
change a single, testable edit.

The document holds boards, cards, sections, links, tags and types. Zustand holds UI state: what is
selected, which panel is open. It never holds document truth, and a reload rebuilds it from the
document.

## The file is the identity

A workspace is a `.canvas` file: a JSON envelope around a base64 Loro snapshot, so a person can read
its header, copy it, and back it up with anything. The shell writes it atomically, keeps a backup
beside it, and refuses to replace a file it could not parse.
`apps/desktop/src/main/store.ts` is the whole of that policy, and it is tested without a window.

A file already open in another window is refused rather than merged. The lock lives in the
machine-local data directory, never beside the file, because a lock in a synced folder carries another
machine's process id.

## The shell

The renderer is served from `app://canvas`, a real origin, rather than `file://`. The resolver, the
page policy and the IPC sender check come from `@suite/desktop`, which the other apps share. The
packaged binary sets the Electron fuses and loads code only from the ASAR.

The shell exposes a small, typed surface over IPC: load, save, flush, export, import, recent files. Every
channel checks that the message came from the page it loaded. No channel takes a path to write, so the
renderer says what to save, never where.

## What it does not have

No account, no server, no telemetry, no hosted build. Sync will arrive as a separate service the user
runs, and the document does not change shape for it. That is why there is one Loro document rather than
a database.

[data-model.md](data-model.md) is the schema. [desktop.md](desktop.md) is the shell in detail.
[the conventions](../explanation/suite-conventions.md) say what Canvas shares with Planner and Budget.
