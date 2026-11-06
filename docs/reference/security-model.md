# Security model

Canvas runs on one machine, reads one file at a time, and talks to nothing. The threat model is
therefore small, and what matters is the file and the process boundary rather than a network.

## What protects the renderer

- **A real origin.** The page is served from `app://canvas`, not `file://`. `file://` gives every page a
  privileged origin and is called out by Electron's security checklist; a registered scheme with a host
  is a normal secure origin, so the app keeps its routes and its storage and the page can refuse to
  reach anything else.
- **A closed page policy.** `default-src 'none'`, `connect-src 'self'`, no inline script.
  `'wasm-unsafe-eval'` is the one allowance, because Loro's CRDT core is WebAssembly. `style-src` keeps
  `unsafe-inline` because the theme is restored before first paint.
- **Sandbox, context isolation, no Node in the page.** `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`. The preload is the entire surface the page can reach.
- **A checked sender.** Every IPC channel verifies that the message came from the page this app loaded,
  comparing scheme, host and port. An absent frame URL is a refusal.
- **A navigation guard.** A window navigates only to its own bundle (or the dev server, while
  developing). A link that would leave the app is opened in the system browser, and only for `http` and
  `https`.

## What protects the binary

The packaged app sets the Electron fuses: no `runAsNode`, no `NODE_OPTIONS`, no CLI inspect arguments,
ASAR integrity validation on, app code loadable only from the ASAR, and no extra privileges for
`file://`. Without them a modified copy can be told to run an arbitrary Node script.

## What protects the document

- **The file is not encrypted.** A `.canvas` file is a JSON envelope around a base64 snapshot: anyone
  who has the file can read the workspace. Protect it the way you protect a document — disk encryption,
  a folder only you can read, a backup that does not go somewhere you would not put the file.
- **Nothing is overwritten on a hunch.** The shell writes atomically, keeps a backup beside the file,
  and refuses to replace a document it could not parse. Recovery is a file manager away, deliberately.
- **One writer per document.** A second window on the same file is refused through a lock in the
  machine-local data directory.

## What Canvas does not do

No network requests, no accounts, no telemetry, no crash upload, no remote code. The dev build talks to
a Vite server on localhost; the packaged build talks to nothing.

## Reporting

Report a vulnerability per [SECURITY.md](../../SECURITY.md). Do not open a public issue for one.
