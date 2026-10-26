# What changed while you were asleep

Eight commits landed between `1722a65` and `1.0.1`. This page is the catch-up: what each one did, and
what to read if you want to check it. It exists because the volume was too large to hand over in a
chat message, and because you should be able to audit it without reading 56,000 lines.

Nothing here is a claim about quality. Read the commits.

## The eight commits

| Commit | Subject | Files | Lines |
| --- | --- | --- | --- |
| `fd6b25a` | make the e2e harness hermetic and tiered | 21 | +474 / −54 |
| `2e9e792` | run accounts, billing and v1 surfaces for real | 463 | +31,250 / −17,226 |
| `c71587f` | close the scale, ops and product gates | 185 | +11,840 / −1,185 |
| `c729368` | remove the transport, projection and billing ceilings | 137 | +9,993 / −1,021 |
| `ae8b3fe` | sell one seat, take a self-host licence, and delete for real | 61 | +2,747 / −143 |
| `c386d71` | a held card could not be placed by a click | 18 | +560 / −212 |
| `316134a` | run accounts and billing on one dev origin | 14 | +224 / −48 |
| `bdd71c6` | release 1.0.1 | 6 | +47 / −19 |

Tags: `v1.0.0` on `c386d71`, `v1.0.1` on `bdd71c6`.

Read one at a time with `git show <commit>`. The `.venv` and `node_modules` churn is not in any of
them; `pnpm-lock.yaml` accounts for 2,295 of the added lines.

## 1. `fd6b25a` — the test harness

Playwright was reusing a Vite server started hours earlier, so a green suite said nothing about the
tree it ran on. This commit made every run own its servers, gave each run its own SQLite files under
`e2e/.data`, and split the suite into areas: `e2e:canvas`, `e2e:collab`, `e2e:views`, `e2e:smoke`.

It also fixed a class of flake: a card's blur timer could end an edit that had already been replaced.

Nothing here touches product behaviour.

## 2. `2e9e792` — the big one

This is 55% of the diff. It answers one question: why did accounts and billing exist but do nothing?

The answer was that `services/auth` and `services/billing` were built, tested and mounted by nothing.
The product ran on an anonymous owner key, which was 32 bytes in `localStorage`, a hash on the relay,
and three recovery paths that all required the key you had already lost.

What the commit did:

- Added `apps/control-plane`, a second server process owning Postgres, Better Auth and Stripe, so the
  relay keeps its sockets and SQLite and gained no `pg` dependency.
- Added `packages/licence` for the token format and its Ed25519 verifier, shared by both processes.
- Deleted the owner key end to end: `session/ownerKey.ts` (512 lines), `session/recoveryWords.ts`
  (2,227), `sharing/RecoveryKeyDialog.tsx` (526), `sharing/WorkspaceProtected.tsx` (298), the
  `#owner=` fragment, `reset-owner`, and 1,566 lines of tests for them.
- Replaced the hand-written Stripe webhook, checkout, portal, event claims and store with
  `@better-auth/stripe`: 4,941 lines deleted, 2,220 added.
- Rebuilt `apps/docs` from Next/Fumadocs to Astro/Starlight, and added `apps/site`.
- Added `apps/canvas/src/feedback`: toasts, a live-region announcer, connection and storage banners.
- Added the Obsidian importer, version history, and starter templates.
- Added four migrations and the `db-verify` assertions behind them.

The parts most worth reviewing: `apps/control-plane/src/modules/auth-billing.ts` (the only file that
knows both auth and billing exist), and `apps/canvas/src/auth/credential.ts` (how a browser turns a
session cookie into the token a socket presents).

## 3. `c71587f` — measurement and ops

- Document writes moved off the event loop to a worker that owns the only write connection.
- An event-loop lag histogram, and a load script whose report names the hardware.
- Every cap enforced with a named refusal code, and the limits page generated from the constants.
- A diagnostics bundle built from an allowlist and scrubbed twice, a CSP report collector, a threat
  model, and a support panel.
- The runtime image proven: non-root, read-only, `cap_drop: ALL`, both modules mounted.
- The e2e suite migrated off owner-key URLs onto a real signed-in session.

## 4. `c729368` — four ceilings

Each was reproduced before it was fixed. This is the commit with numbers worth trusting, all recorded
in `apps/collab-server/bench/report.md`.

- A board above roughly 240 cards never synced. The relay's join backfill sent one `DocUpdate` that
  `loro-protocol` refuses to encode above 256 KiB. The protocol already fragments and the client
  already reassembles; only that send did not. Now a 2.1 MiB, 2,000-card board syncs.
- The 20-second share build was not a slow build. Every rebuild cleared and rewrote each projection
  root, so a room's CRDT history grew by a whole board per save. Writing only the difference took
  share p50 from 20,534 ms to 1,993 ms and RSS from 418 to 314 MiB.
- A paying account was enforced at the free tier, because nothing wrote `organization_licences`.
- A fresh deployment could not create its first organization at all, while every unit test passed,
  because only the verification script seeded the row.

Plus accessibility: six menus that declared `role="menu"` and never took focus, five dialogs with
`aria-modal` and no trap, pointer-only library rows.

## 5. `ae8b3fe` — money and deletion

- Plans sell one seat (ADR-0082), because the plugin writes member count into the seat ceiling, so
  seat pricing would bill per head and still admit one person.
- Self-host takes a signed licence from the environment (ADR-0081), verified at boot, refusing to
  start when expired, wrong-key or malformed.
- Account delete now erases documents, shares and attachments through the relay, with a dedicated
  purge token rather than the admin token.

## 6. `c386d71` — one product bug

A held card could not be placed by a click. The board rebuilds `PlacementEngine` on every render and
the press listener carried it as a dependency, so every render removed and re-added the handler. It
read as a test problem for three runs before the cause was obvious.

## 7. `316134a` — the dev stack

The canvas on `:5173` asked its own origin for `/api/auth/ok`, got Vite's SPA fallback, and concluded
no account service existed. Only the e2e harness had a proxy. This added one to the dev server, plus
`dev:env` and `dev:db`.

## 8. `bdd71c6` — release 1.0.1

Version, changelog, tag.

## Where the debt actually is

Not in the code volume. In three things:

1. **No review points.** I kept going after each wave instead of stopping where you could look. That
   was my call and it was wrong.
2. **Two stale lines.** `.env.example` and `.env` named `pnpm dev:stripe`, a script I deleted. That
   single line sent you looking for a command that never existed.
3. **No state command.** Nothing told you Postgres was down, billing was half-configured and the
   Stripe CLI was missing. `pnpm check:env` now does.

## How to check it

```sh
pnpm check:env          # what is set up, and what fixes the rest
pnpm dev:env            # a .env with accounts on, if you want a clean one
pnpm dev:db && pnpm dev # Postgres, then the three processes
```

Open <http://localhost:5173> and sign in. Billing is optional and stays off until four values exist;
sign-in, organizations and sync do not need it.

To review rather than run:

```sh
git show fd6b25a        # the harness, no product change
git show c386d71        # the smallest real bug fix, as a template for the others
git show 316134a        # the dev proxy, readable in one sitting
```

`2e9e792` is the one that needs real review. Start at the two files named above rather than the diff.

## If you would still rather roll back

```sh
git switch -c v1-work
git switch main
git reset --hard 1722a65
```

That restores the owner key and removes sign-in. The branch keeps this work reachable.
