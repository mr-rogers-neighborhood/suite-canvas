# Suite

> **Suite is alpha software.** The hosted deployment at <https://app.suite.run> is real and the
> paying path is real, but expect rough edges and expect the shape of things to change.
>
> A subscription is **early access** to sync, collaboration and file uploads, and paying for one is
> how the project is funded while it is alpha. It is optional twice over: the canvas, the cards and
> export work without one, on this device, with no account and no limit; and the source is public
> under MIT, so you can run the whole thing yourself. A self-hosted relay needs no licence token and
> enforces no limit ([self-hosting](docs/reference/billing.md)); a licence is only what a *seller*
> issues to somebody else.
>
> The hosted deployment bills monthly through Stripe, which holds the card while this deployment
> never sees it. A discount code, if somebody gave you one, is entered on Stripe's own page, and a
> plan cancels from the portal.
>
> One thing that is easy to discover too late: **a workspace is this browser's copy until a plan puts
> it in your account**, so clearing site data takes it with it. Export is always available and never
> asks for a plan.

Suite is a local-first, collaborative canvas for connected thinking. A workspace owns its cards and
the boards they appear on: cards are objects first, and a board is a view that places them. Every edit
lands in one Loro CRDT, `@suite/graph` validates each write with Zod before it reaches the document,
and the canvas keeps working offline.

**Status: alpha, `0.1.0-alpha.1`, MIT.** Hosted billing is live: accounts, organizations, invitations,
checkout, the billing portal and the licence projection all run, in Stripe's test or live universe
according to one setting. A free account is a local account, unlimited on this device; sync is the
paid feature, and the same tier table prices it in both universes so a test run exercises what a live
one will.

![Suite](assets/preview-dark.png)

## Quick start

```sh
pnpm install
pnpm dev:env   # accounts on, session secret generated
pnpm dev:db    # Postgres for accounts and billing
pnpm dev
```

Open <http://localhost:5173>. The canvas runs on 5173, the Loro relay on 1234, and the control plane
that owns accounts and billing on 1236. A second window at the same URL shows live edits, titles and
presence.

`pnpm dev:env` writes a `.env` and never overwrites one. Without it, `pnpm dev` still serves the
canvas and the relay, so the app is local-only. The control plane refuses to start and names the
variable it needs, rather than pretending accounts work.

`pnpm check:env` reports what is set up and what is not, one line each, with the command that fixes
the failing ones. Run it before opening an issue about the stack.

Node 22 or newer and pnpm 12.13.0, both pinned in `package.json`. [Run Suite
locally](docs/tutorials/run-locally.md) covers the standalone bundle and custom ports.

## Documentation

| | |
| --- | --- |
| [Tutorials](docs/tutorials/index.md)<br>Learn by doing: one guided path to a first workspace. | [How-to](docs/how-to/index.md)<br>One job at a time: add a feature, test, deploy, operate, release. |
| [Reference](docs/reference/index.md)<br>Facts to look up: architecture, conventions, limits, security. | [Explanation](docs/explanation/index.md)<br>Why the product and the code are shaped this way. |

[docs/README.md](docs/README.md) is the dashboard for the four sections.

## Commands

| Command | What it runs |
| --- | --- |
| `pnpm check` | Biome, `tsc` across the workspace, the Vitest files your change reaches, docs symbols, shape |
| `pnpm lint`, `pnpm typecheck`, `pnpm test` | Biome, `tsc` across the workspace, and every Vitest project |
| `pnpm docs:check` | Links, fences, banned prose, generated indexes, limits |
| `pnpm docs:symbols` | Backticked paths, root scripts, ADR references |
| `pnpm shape` | File length, observe sites, raw Loro writes |
| `pnpm verify` | The local gate plus the billing tests, the story tests and the build |
| `pnpm build` | `@suite/graph` dist, then the canvas bundle |
| `pnpm storybook` | Component workshop on :6006 |
| `pnpm docs:site` | The docs site on :3001 |
| `pnpm e2e:smoke` | The `@smoke` Playwright specs, the narrowest e2e run |
| `pnpm e2e:canvas` / `e2e:collab` / `e2e:views` | One e2e area |
| `pnpm e2e` | Every Playwright spec, a milestone action |
| `pnpm e2e:doctor` | Report processes holding the e2e ports before a run |
| `pnpm limits:check` | `docs/reference/limits.md` still matches the code |

The gate is local: `pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check && pnpm docs:symbols &&
pnpm shape`. Playwright runs when the owner asks for it, not on every change, and no workflow gates
`main`. [Test and verify a change](docs/how-to/test-and-verify.md) has the tiers and the e2e area
scripts.

## Repository layout

```
apps/canvas          React 19 canvas: React Flow surface, Tiptap editors, Zustand UI store
apps/collab-server   Loro WebSocket relay, six SQLite stores, attachment serving
apps/docs            The documentation site (Astro, Starlight)
apps/site            The marketing site (Astro)
apps/control-plane   Accounts, organizations and billing on Postgres, beside the relay
packages/graph       @suite/graph: Zod schema and the typed WorkspaceDocument layer
packages/licence     The licence token format and its Ed25519 verifier
services/auth        Better Auth: sign-up, sessions, passkeys, organizations, invitations
services/billing     Stripe through @better-auth/stripe, plus the entitlement read
e2e                  Playwright specs, tagged for the smoke tier
docs                 Tutorials, how-to, reference, explanation
deploy               Caddyfile, backup and restore scripts, drill records
```

## How it works

One `LoroDoc` per workspace holds boards, cards, placements, sections, types, tags, edges, the
derived reference index and per-card rich text. `WorkspaceDocument` is the only write path, and it
validates with Zod before touching Loro. `LoroIndexeddbPersistence` stores a snapshot plus an update
log in the browser, so a reload resumes offline; the `loro-websocket` provider syncs the same document
when a relay is reachable, and the relay flushes each room to SQLite. Presence and live drag positions
ride `EphemeralStore` channels and are never written to the document. Zustand holds UI state only.

[Architecture](docs/reference/architecture.md) has the data flow, layer by layer.

## Sharing

`Share` opens one dialog for the workspace, the active board or the selected card. Every grant is a
bearer capability: the owner link is the workspace URL plus an owner-key fragment, and editor, viewer,
board and card links arrive as `?share=<token>`. The relay stores only hashes and authorizes each join
per room as `read` or `write`. [Security model](docs/reference/security-model.md) lists what each link
grants and what it withholds.

## Workspace files

`File → Export a backup` writes a `.suite` file; the launcher opens one. `File → Recovery key` saves
the `.suitekey` file, the way back into a workspace when the relay is gone. The key is never inside a
`.suite` backup, because that file gets copied and shared, so keep both.

## Running a server

One `Dockerfile`, one `compose.yaml`, one domain: Caddy terminates TLS and proxies `/api/*` and `/ws`
to the single app container, whose six SQLite stores sit on one volume.

- [Deploy a server](docs/how-to/deploy.md): the instance, the environment and the first boot.
- [Operate a deployment](docs/how-to/operate.md): watch, back up, restore and tune a running host.
- [Security model](docs/reference/security-model.md): every credential, what the relay can read, and
  what the account layer will add.

`.github/workflows/release.yml` defines the tag release and sits unrun on this account;
[Release and roll back](docs/how-to/release.md) has the manual build path and the rollback that
re-pins the previous digest.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) is the short version and
[docs/how-to/contribute.md](docs/how-to/contribute.md) the full one. [AGENTS.md](AGENTS.md) holds the
rules for human and AI contributors. Report a vulnerability per [SECURITY.md](SECURITY.md);
participation is covered by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
