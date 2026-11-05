# Run the desktop app

The Canvas desktop application is one renderer in a shell that owns a file. This page is the loop for
working on it. It assumes a checkout and `pnpm install`.

## The development loop

```sh
pnpm dev:desktop
```

That starts the renderer on Vite in the profile the shell actually runs (`standalone`, so no relay and no
account client), waits for it to answer on `:5173`, then opens the window on it. A component edit appears
without a reload. An edit to the main process or the preload restarts the window, which reopens the file
, which is the same path a crash takes.

Closing the window stops the dev server, so `:5173` is not left held by a process nothing is watching.

Two flags:

| Flag | What it changes |
| --- | --- |
| `--no-watch` | No restart on a main-process change, for when a restart would interrupt something |
| `pnpm dev:desktop` with `SUITE_DEV_PORT=5174` | A different renderer port |

`pnpm dev` is unchanged and still starts the servers a browser talks to. The desktop app is not one of
them: it is a window, not a server, and a task graph that waits for it never finishes.

## The window against a built bundle

The packaged app loads `apps/canvas/dist` instead of a dev server, so a question about packaging is
answerable without packaging:

```sh
pnpm --filter @suite/desktop build      # builds the standalone renderer, then the shell
pnpm --filter @suite/desktop dev:shell  # a window on the bundle
```

`dev:shell` reads `SUITE_DESKTOP_DEV_URL` when it is set, so pointing it at a Vite server by hand does
the same thing `dev:desktop` does.

## Where the files are

| Thing | Where |
| --- | --- |
| Workspace files | `~/Documents/Suite/Canvas` |
| Backups | beside the file, `<name>.<stamp>.bak` |
| Locks and recent files | the per-user data directory |

`SUITE_CANVAS_LIBRARY` and `SUITE_CANVAS_DATA` override the first and the third. Both exist for a test or
a portable install; neither is read from a document.

## Testing it by hand

Start a workspace from the launcher: the file appears in `~/Documents/Suite/Canvas` immediately, named
after the workspace. Edit something, quit, and drag the file onto the app; the edit is there.

Two checks are worth doing deliberately, because each one is a promise:

1. **A refused second window.** **Developer → Open this file in a second window**. It launches with its
   own Electron profile on purpose: without that, Electron's single-instance lock answers first and the
   *file* lock, the one that stops two documents overwriting each other, is never reached. You should
   get a dialog naming the other window.
2. **Recovery.** Copy the file, truncate the copy, and put the good version back as a `.bak` beside it.
   Opening the truncated file recovers from the backup and leaves the damaged file exactly as it was,
   because it is the only copy of whatever happened.

## The gate

```sh
pnpm e2e:desktop
```

Eight specs against the built bundle: open, save and reopen, a legacy conversion, a refused second
process, recovery from a backup, creation from the launcher, the recent list and the shell's open dialog.
They run serially, and they need a display, so on a headless machine run `xvfb-run pnpm e2e:desktop`.

A packaged build cannot be driven by these specs, because its fuses switch off `NODE_OPTIONS` and the
CLI inspect arguments Playwright attaches with. That is the intended trade, so packaged verification is
observational: the app runs, opens a document and writes backups.

## What the loop does not exercise

- `app://` asset resolution and the page policy, which only the built bundle uses. `pnpm e2e:desktop`
  covers those.
- Anything hosted: sign-in, sync, sharing. The desktop build is the local profile.
