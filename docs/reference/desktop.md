# Desktop

The Canvas desktop application. It is the same renderer the web build serves, wrapped in a main process
that owns a file the user chose. It does not cover the document model ([data-model.md](data-model.md));
that is the renderer's business, and the shell never reads it.

## Two hosts, one renderer

`apps/canvas` is one bundle in three deployments. What changes is not the UI but what the page can reach,
and the renderer asks rather than assumes.

| | `apps/canvas/src/host/bridge.ts` says | Local copy | Shape |
| --- | --- | --- | --- |
| Web, hosted | `hostKind()` is `"web"` | `LoroIndexeddbPersistence` | relay and sharing in parity |
| Web, standalone | `hostKind()` is `"web"` | `LoroIndexeddbPersistence` | no relay, no account |
| Desktop | `hostKind()` is `"desktop"` | `LoroDesktopPersistence` | one file, no relay, no account |

The host is **not** a build flag. A flag would say what was compiled; the renderer needs to know what
actually loaded beside it, so `hostKind()` looks for the `suiteDesktop` object the preload publishes. A
desktop build with no bridge throws at boot rather than opening a session that persists nowhere. The one
failure this product cannot accept is a session that silently keeps nothing.

A bridge that exists is not automatically a bridge this build can use. A window left open by an earlier
build keeps the preload it loaded, so a method added since then is simply absent, and asking for it calls
`undefined` while the window still looks functional. `REQUIRED_BRIDGE_METHODS` in
`apps/canvas/src/host/bridge.ts` lists what the renderer calls, `bridgeMissing()` compares that list with
what the preload published, and boot renders one sentence instead of configuring a session:
"This window's shell is out of date. Restart Suite to load the current shell."

`createWorkspacePersistence` is the single decision point, and the `WorkspacePersistence` port has three
methods (`load`, `flush`, `destroy`) because that is all the store uses. Multi-tab leadership and
compaction stay inside the IndexedDB adapter, where coordination belongs; the file adapter has no peers
to coordinate with because the lock makes sure of it.

## What owns what

The main process is a **file** authority, not a document authority.

```
apps/desktop/src/main
  index.ts    lifecycle, single instance, protocol, window, menu, IPC handlers
  store.ts    open, save, convert, recover, the mtime guard, the debounce
  lock.ts     one writer per file
  paths.ts    library, data directory, lock names
  protocol.ts the page policy and the asset resolver
apps/desktop/src/preload
  index.cjs   the bridge, in CommonJS because a sandboxed preload cannot use ESM
```

The renderer owns the document: it has the schema, the editors and the attachment store. So a save is a
payload: a snapshot, the manifest counts, and the attachments when they changed. The main process
assembles the envelope, writes it atomically and keeps the attachment section it was last given. A
routine autosave therefore does not re-encode megabytes of images, and the main process never holds a
second copy of a document it does not edit.

## The document's identity

The file *is* the document. The workspace id lives inside the envelope, so the address bar names no
workspace at all: the window loads `index.html?desktop=1` and the renderer asks the shell what is open.

That has to happen before `./store` is imported, because that module reads the session once at import
time to pick its room and its persistence. `main.tsx` therefore awaits the shell, configures the
session, and only then imports the store. The store stays synchronous, which is what keeps the change
small: three non-test modules ever read the id.

The snapshot comes with that answer and is handed to the persistence adapter, so a large document
crosses the IPC boundary once on open rather than twice. The board is still remembered, through the
store the URL used to carry on the web.

## Where things live

Two roots, and the split is the decision:

| Artefact | Location | Why |
| --- | --- | --- |
| Workspace files | `~/Documents/Suite/Canvas` (the suite convention, from `@suite/contracts`) | A person looks there, so it can be copied, backed up, or put in a folder their own cloud already syncs: local-first with no relay |
| Backups | Beside the document, `<name>.<stamp>.bak` | "Recover with a file manager when the app is the thing that broke" is a promise the format makes |
| Locks | The per-user data directory | A lock beside a synced file would carry another machine's pid, and every sync would look like a contended file |

`SUITE_CANVAS_LIBRARY` and `SUITE_CANVAS_DATA` override both roots. They exist for tests and a portable
install, and neither is read from a document, so no file can steer a write.

## The four guards

Each one exists because the file is the only copy — and each one has a test named after it.

1. **The lock.** One writer per file. `<sha256(path)>.json` with a pid, a hostname, a start time and a
   heartbeat. A second process is **refused**, not warned: two documents each holding a snapshot overwrite
   one another and the loser's work is gone with no error anywhere. A lock from the same machine goes
   stale after 30 seconds without a heartbeat; a lock from another machine never does, because a clock
   difference or a sleeping laptop would otherwise let two machines write.
2. **The atomic write.** Temp file, `fsync`, `rename`, then `fsync` the directory, all from
   `@suite/files/node`. A crash mid-write leaves the previous version intact rather than a truncated
   envelope no reader will accept.
3. **The mtime guard.** The store records the size and modification time it last wrote. If the file moved
   underneath it, whether a sync client, an editor or a restore, writing stops and the user is told,
   instead of racing whatever did it.
4. **Recovery.** A file that will not parse is never replaced by an empty one. Backups are tried newest
   first; if one reads, the document opens from it and the damaged file is left exactly as it was.

## The `.canvas` conversion

Opening a legacy `.suite` canvas file writes the `.canvas` beside it, validates the new file, and keeps
the original. The conversion is a rename, not a re-export: `migrateWorkspaceFile` copies the snapshot
verbatim, because re-exporting would mint a new version vector and change bytes the user never touched.

## What the desktop build is not

It is the `standalone` profile. There is no relay, no account and no sharing, and the page policy's
`connect-src 'self'` makes that structural rather than a promise. Hosted sign-in and sync arrive with
`@suite/identity`; until then a half-working sign-in would be worse than none, because a session cookie
set for `app.suite.run` does not apply to an `app://` origin.

## Local sync (dev)

The desktop shell can point at a user-run `suite-sync` server for the two-copy demo:
`SUITE_SYNC_URL`, `SUITE_SYNC_MEMBER`, `SUITE_SYNC_WORKSPACE`, `SUITE_SYNC_EPOCH` and
`SUITE_SYNC_DEVICE`. `rendererUrl` passes them to the page, and `desktopCsp` adds the server origin to
`connect-src` only when `SUITE_SYNC_URL` is a `ws:` or `wss:` URL. The transport is plaintext and
loopback-only; [the suite-sync demo](https://github.com/mr-rogers-neighborhood/suite-sync/blob/main/docs/how-to/canvas-sync-demo.md)
has the commands. It is not the shipped security model.

## The page policy

`app://canvas` is a real, secure origin, so a document keeps the query-parameter routes it already has
(`?workspace=…`) and relative asset paths still resolve. `DESKTOP_CSP` is the deployment's policy with
`connect-src 'self'` and `wasm-unsafe-eval`, because Loro's core is WebAssembly and a sandboxed
renderer without it cannot open a document at all.

`script-src` has no `unsafe-inline`. The one inline script the app used to carry, the Excalidraw asset
base, is `apps/canvas/public/excalidraw-assets.js` now, which is also what lets the deployment's own
policy keep it strict. `style-src` keeps `unsafe-inline` because the theme, radius and density are
restored before first paint.

The asset resolver refuses any request whose path contains `.` or `..`, read from the **raw** URL: a
WHATWG URL normalises `a/../b` to `b` before anyone can inspect it, so a climb would otherwise be
silently reinterpreted as a legitimate path.

## The renderer seam

The window loads one of two pages, decided in `apps/desktop/src/main/rendererUrl.ts`:

| `SUITE_DESKTOP_DEV_URL` | Page | Used by |
| --- | --- | --- |
| set | that server's `/index.html` | `pnpm dev:desktop` |
| unset | `app://canvas/index.html` | the packaged app and `pnpm e2e:desktop` |

Every navigation goes through it: the launcher, an opened document and the `will-navigate` guard.
A window that half-follows the seam bounces between two origins on the first open. The rule is a
pure function so it is a test rather than something only a running window discovers.

The main process restarts rather than hot-swapping on a change. It owns the document, the lock and the
backup timer, and replacing those under a live window would be a story about state that is not true. A
restart reopens the file, which is also the path a crash takes, so the loop exercises recovery every
time.

## Images in the file

The editor writes pasted bytes to IndexedDB; the shell writes the file. A save therefore carries the
attachment set, and the renderer sends it only when the set of referenced ids changed, comparing
`documentAttachments` against what it last sent, so a routine autosave does not re-read every image. The
shell keeps the last set it was given, so a later document-only save preserves them.

An image whose bytes are gone is reported and skipped, never a reason to refuse the save.

## The build pairing

The desktop shell loads `apps/canvas/dist`, so the profile that bundle was built
with matters: the shell is the `standalone` profile, and a `relay` bundle
constructs the account client against an `app://` origin, which fails before the
window can render. `apps/desktop`'s own `build` therefore runs
`build:standalone` first, rather than leaving the pairing to whoever remembers.

`accountBaseFor` in `apps/canvas/src/auth/client.ts` is the second half of that
guard: an origin that cannot carry the account client gets a valid but
unreachable base instead of a throw at import time, because a throw there takes
down screens that have nothing to do with accounts.

## Packaging

`electron-builder.yml`. The `deb` is the primary Linux target because it carries the `.canvas` MIME
association, which lives in the desktop entry a package installs; the AppImage is the portable
alternative and registers it at runtime.

The app claims no URL scheme of its own. `suite://` belongs to Suite Start, which routes a link by
launching this app with it, and a second scheme that nothing registers would be a promise the app does
not keep.

Electron fuses are set: `runAsNode` and `NODE_OPTIONS` off, ASAR integrity on, and app code loadable only
from the ASAR. Without them a modified binary can be told to run any Node script.

macOS and Windows are configured and cannot be produced here: both need a signing identity this
repository does not have, and an unsigned build is not something to hand a user.
