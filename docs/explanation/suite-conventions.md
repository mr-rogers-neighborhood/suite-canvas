# What the suite shares

Three applications and a hub. What makes them a suite is not a database: it is a set of
conventions small enough that each app can be installed, opened and used on its own, and still feel
like part of one product.

## The rule

**Files stay per-app. The suite shares conventions, not state.**

The tempting alternative is one local store that every app reads and writes. It is the wrong
architecture for the same reason a shared database between services is wrong: one schema, one
migration, one corruption blast radius, and a budget bug that can stop a canvas from opening. Three
apps writing one document would also have to agree on one merge history, one permission model and one
version number, which is the coupling the separate files exist to avoid.

So each app owns its document, its schema, its renderer and its release. What crosses the boundary is
narrow enough to state in a paragraph.

## What crosses the boundary

| Shared | Where | Why |
| --- | --- | --- |
| Where documents live | `~/Documents/Suite/<App>` | A person looks there, and a folder their own cloud already syncs is local-first without a relay |
| Where machine state lives | the per-user data directory | A lock beside a synced file carries another machine's process id |
| Backups | beside the document, `<name>.<stamp>.bak` | "Recover with a file manager when the app is the thing that broke" |
| Link shape | `suite://<app>/…` and `suite://<app>/workspace/<id>` | One form to match, so a hub can route without knowing the app |
| App manifest | `suite.app.json` beside the executable | The hub discovers what exists; the manifest cannot name a binary |
| Install record | the hub's own data directory | The only place an executable path lives |
| App table | `SUITE_APPS` in `@suite/contracts` | Id, display name, folder and extension per app, so the hub lists a planner's files without importing planner |

These live in `@suite/contracts`, which imports nothing from Node so a renderer can load it too.

## What does not

- **A shared store.** No app reads another's document, and there is no cross-app database.
- **Foreign keys.** A cross-app reference is a link string, never an id that implies integrity. A
  missing app is a prompt to install it, not a broken row.
- **Live state.** The hub does not push updates between apps, and closing one does not affect another.
- **A shared runtime.** Separate processes, separate windows, separate update feeds.
- **One schema.** A `.canvas` is canvas's, a `.planner` is planner's. A bundle is a container of those
  files, not a fourth format.

## The app table, and the index

`SUITE_APPS` names each app's id, display name, documents folder and file extension. The hub reads one
level of each folder and lists what it finds, with the app that claims it.

That index is a reading, not a store. It keeps no names, no pins and no last board, because a second list
that disagrees with the app's own library is worse than no list. Opening a file is all a row offers.

A file whose app is not installed is listed rather than hidden, and the row says no app is installed. A
missing app is a prompt to install it, never a broken reference.

## What "integrated" then means

It means the parts a person actually notices:

- One account, optional, and never required for a local file.
- One launcher that knows what is installed and what was opened last.
- One update surface, with each app updating itself from its own signed release.
- Links that open the right app, and file associations that open the right file.
- The same file-location convention, so a person who finds one app's files finds the others'.

That is a suite. It is also four things that still work when the other three are uninstalled.
