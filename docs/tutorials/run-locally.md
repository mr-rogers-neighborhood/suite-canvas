# Run Suite locally

This tutorial takes a checkout to a working canvas in one browser. It is one path with nothing to
decide. Variants such as the standalone bundle, custom ports and a remote relay are how-tos.

You need Node 22 or newer and pnpm 12.

## 1. Install

```sh
pnpm install
```

The install also prepares the git hooks.

## 2. Start the app, the relay and the accounts

```sh
pnpm dev:env   # once: writes a .env with accounts on and a generated secret
pnpm dev:db    # Postgres on 127.0.0.1:5433, in a container
pnpm dev
```

`pnpm dev` runs three watchers: the canvas on <http://localhost:5173>, the collab server on port 1234
for the Loro WebSocket and 1235 for its HTTP API, and the control plane on 1236 for accounts and
billing.

The dev server proxies `/api/auth`, `/api/billing`, `/api/workspaces`, `/api/invites` and `/stripe`
to the control plane, and `/api` and `/ws` to the relay, so everything answers on the one origin the
page is served from. That is the same shape Caddy provides in a deployment, and it is what makes the
session cookie first-party: without it the account surface reports itself unavailable.

`pnpm dev:env` never overwrites an existing `.env`. Run it with `--force` to write `.env.new` beside
the current one and diff them.

## 2a. Sign in

Open <http://localhost:5173> and use the account entry in the launcher or the title bar. Sign-up is
open, and `.env` sets `SUITE_AUTH_REQUIRE_VERIFICATION=0` because there is no mailbox locally. With it
unset the address must be confirmed first, and the console transport redacts the token it prints, so
you could not finish a sign-up at all.

Signing up creates an account. Creating a workspace creates an organization, and the account becomes
its owner. The room credential is a five-minute token that the relay verifies against the key set the
control plane publishes.

## 2b. Check what is set up

```sh
pnpm check:env
```

One line per dependency. Anything marked `FAIL` blocks the app; anything marked `note` is optional.
Each line names the one command that fixes it. Signing in needs Node, pnpm, Docker, Postgres and the
`SUITE_AUTH_*` values, and nothing else.

## 2c. Billing in test mode (optional)

Sign-in, organizations, seats and sync all work without Stripe. Only checkout and the customer portal
need it, and they stay switched off until the four values exist.

The Stripe CLI is a separate install, and logging in is a browser flow:

```sh
# install, then:
pnpm stripe --login      # opens a browser, then creates the fixture prices
```

It prints three values. Put them in `.env` next to the key you already have, set
`SUITE_BILLING_ENABLED=1`, and restart `pnpm dev`:

| Value | Where it comes from |
| --- | --- |
| `STRIPE_SECRET_KEY` | the CLI's stored test key, printed by `pnpm stripe` |
| `STRIPE_PRICE_TIERS` | printed by `pnpm stripe` |
| `STRIPE_WEBHOOK_SECRET` | printed by `pnpm stripe --listen` |

Forward deliveries in a fourth terminal:

```sh
pnpm stripe --listen
```

`pnpm stripe --clock` creates a test clock for a renewal or cancellation run. Nothing here touches a
live account. `pnpm check:env` says whether all four values are present.

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

```sh
pnpm check:env
```

That is the first thing to run: it distinguishes "Postgres is not up" from "accounts are not
configured" from "the processes are simply not running", and says which command fixes each.

Port 5173, 1234 or 1235 is already in use. Stop the process that owns it, or run the canvas alone with
`pnpm --filter @suite/canvas dev` and skip sync. A canvas without the collab server still edits and
persists in this browser; the title bar reads **Offline**.

If the page loads but the document is empty, check the browser console for an IndexedDB error. A
private window with storage disabled cannot persist a workspace.

The environment variables, store paths and build profiles are in
[environment.md](../reference/environment.md). The test tiers are in
[test-and-verify.md](../how-to/test-and-verify.md).
