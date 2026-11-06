# Run Canvas on this machine

You need Node 22 or newer and pnpm 12.13.0. Nothing else: no database, no container, no account.

```sh
git clone https://github.com/mr-rogers-neighborhood/suite-canvas.git
cd suite-canvas
pnpm install
pnpm dev
```

`pnpm dev` starts the renderer at <http://localhost:5173>. The browser build keeps its workspace in
local storage, which makes it the fastest loop for UI work: a reload resumes where you were.

## The thing that ships

The desktop app is an Electron shell around the same renderer, and it owns a real file:

```sh
pnpm dev:desktop
```

That starts the shell against the dev server, so an edit appears in the window. To build the article a
person would install:

```sh
pnpm --filter @suite/desktop package:dir
```

The unpacked binary lands in `apps/desktop/release/linux-unpacked`. Start it directly, or point Suite
Start at it — the hub discovers an app by the manifest beside its executable.

## Where a document goes

The first workspace is created under `~/Documents/Suite/Canvas`, and the file is the document: copy it,
back it up, or open it on another machine and the workspace comes with it. Export is always available
from the workspace menu, and produces the same envelope.

## Two windows on one document

Refused on purpose. A second window on a file that is already open is a second writer, and the shell
would rather say so than let two writers find out later. Open a different workspace, or close the first
window.

## Working on the whole suite

Suite Start (the hub) and Suite Sync (the service) are separate repositories. `suite-dev` clones them
side by side, stages the real binaries and runs the cross-app end-to-end suite; its README is the
place to start.
