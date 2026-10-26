# Run Suite locally

This tutorial takes a checkout to a working canvas in one browser. It is one path with nothing to
decide. Variants such as the standalone bundle, custom ports and a remote relay are how-tos.

You need Node 22 or newer and pnpm 12.

## 1. Install

```sh
pnpm install
```

The install also prepares the git hooks.

## 2. Start the app and the relay

```sh
pnpm dev
```

This runs two Vite/tsx watchers: the canvas on <http://localhost:5173> and the collab server. The
server listens on port 1234 for the Loro WebSocket and on port 1235 for its HTTP API. Open the canvas
URL in your browser.

## 3. Create a workspace

The app opens on the workspace launcher. Choose **New workspace**. The workspace is written in this
browser and opens straight away, with no account and no credential to keep: you can sign in later and
the workspace comes with you.

A new workspace starts blank: one board, no cards. Workspaces created before the blank default keep the
two starter cards they were seeded with.

The URL now names the workspace (`?workspace=<id>`). Bookmark it. The id is the sync room and the
IndexedDB key, so the same URL opens the same document.

## 4. Check that it persists

Add a card with **New card**, type a title, then reload the page. The card and its title are still
there. The document is stored in IndexedDB as a Loro snapshot plus an update log, so a reload rehydrates
without the network.

## 5. Open a second window

Open the same URL in a second window. Edit a title in one window. The other window shows the change,
the caret and the peer name. The relay is carrying Loro updates between the two clients.

Stop the app with `Ctrl-C`.

## If it does not start

Port 5173, 1234 or 1235 is already in use. Stop the process that owns it, or run the canvas alone with
`pnpm --filter @suite/canvas dev` and skip sync. A canvas without the collab server still edits and
persists in this browser; the title bar reads **Offline**.

If the page loads but the document is empty, check the browser console for an IndexedDB error. A
private window with storage disabled cannot persist a workspace.

The environment variables, store paths and build profiles are in
[environment.md](../reference/environment.md). The test tiers are in
[test-and-verify.md](../how-to/test-and-verify.md).
