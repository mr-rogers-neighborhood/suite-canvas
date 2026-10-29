# Architecture

Suite is a local-first collaborative canvas. One Loro document per workspace is the source of truth, `@suite/graph` validates every write, and the React canvas renders a projection of that document. A card exists whether or not a board displays it; a board is a view that places cards.

This page is the map. Each subsystem has its own reference page, and the reasoning behind a choice is recorded in the internal decision log, which is not part of the deployed docs.

## Three rules

1. Offline works. The network accelerates sync; it is not required to open or edit a workspace.
2. Loro owns the document. The UI reads through `@suite/graph` and writes through typed methods, never raw Loro.
3. Every write is validated. Zod schemas in `packages/graph/src/schema.ts` parse at the boundary before a value reaches the CRDT.

## Repo map

| Path | Responsibility |
| --- | --- |
| `apps/canvas` | React 19 canvas, Tiptap editors, panels, launcher, Zustand UI state |
| `apps/collab-server` | Loro WebSocket relay, HTTP API, SQLite stores, projection worker |
| `packages/graph` | Schema, records, typed CRDT layer, pure planning and projection |
| `services/auth` | Identity, organizations, invitations, seats, licence checks |
| `services/billing` | Stripe webhook, hosted licence issue |
| `apps/control-plane` | Accounts, billing and the Postgres they share, in one process of its own |
| `apps/docs` | Starlight site built from `docs/` |
| `apps/site` | Marketing page for `suite.run` |
| `e2e` | Playwright journeys, grouped by area |
| `scripts` | Docs, limits, shape and docs-symbol checks |

The canvas app starts at `/` with a workspace launcher. A workspace open uses `?workspace=<id>` (`?doc=` is a legacy alias), and a share link uses `?share=<token>`.

## Data flow

```
pointer / keyboard
      │
      ▼
React surface ── typed method ──► WorkspaceDocument ── Zod ──► LoroDoc
      ▲                                  │
      │                                  ▼
      └──── snapshot store ◄──── observe ─┘
```

`WorkspaceDocument` is the only writer. It exposes a facade over domain modules in `packages/graph/src/loro/`, and each mutation validates with the schema before it commits. `apps/canvas/src/store/workspaceSnapshotStore.ts` owns the one `WorkspaceDocument.observe` call site; components read stable records from that store through selectors.

Rich text lives in `content` and `titles` containers. The snapshot store exposes `subscribeCardChanges` for consumers that need text edits, so no other module subscribes to the document itself.

Zustand holds UI state only: selection, active board, open panels, connection status, transient gestures. Document truth never lives there.

## Subsystems

| Page | Covers |
| --- | --- |
| [data-model.md](data-model.md) | Roots, record shapes, leaf writes, text containers, references, publish and projection |
| [canvas.md](canvas.md) | Boards, placements, sections, links, gestures, camera, presence |
| [editing.md](editing.md) | Tiptap, title/body, fields, templates, cards, references, undo |
| [ui.md](ui.md) | Shell, library, panels, dialogs, styles, command palette, focus, accessibility |
| [runtime.md](runtime.md) | Boot order, persistence, relay, shares, authorization, attachments, diagnostics |
| [security-model.md](security-model.md) | Trust boundary, credentials, capabilities, what a share exposes |
| [billing.md](billing.md) | Stripe events, licence claims, hosted mode |
| [environment.md](environment.md) | Every variable the relay and services read |
| [limits.md](limits.md) | Every quota, default and enforcing function |
| [conventions.md](conventions.md) | Code shape, naming, errors, tests |
| [glossary.md](glossary.md) | Terms used across the pages |

## Toolchain

pnpm workspaces plus Turborepo. One package per bounded surface, so `@suite/graph` tests without React and the relay tests without a browser.

Biome handles lint and format. Vitest covers graph, server, auth and canvas. Storybook runs the visual and accessibility stories. Playwright covers end-to-end journeys. Billing sits outside the pnpm workspace and runs under `node --test`.

Commands and tiers are in [../how-to/test-and-verify.md](../how-to/test-and-verify.md). Deployment is [../how-to/deploy.md](../how-to/deploy.md).

## Status

Local persistence, accounts, live collaboration, share links, publishing and billing are implemented. A
browser with no session works locally and syncs nothing; a signed-in account has a personal organization from
its first minute.

Two processes are the target shape, behind one Caddy. The relay (`apps/collab-server`) keeps the socket, its SQLite stores and the projection. A control plane (`apps/control-plane`) hosts Postgres, identity and billing, and is the only process that depends on `pg`: it mounts `services/auth` at `/api/auth/*` (the Stripe webhook is `/api/auth/stripe/webhook`) and `services/billing` at `/api/billing/*`, and the relay imports neither. The canvas is a static bundle, so a deployment serves three hosts from that pair (`deploy/Caddyfile`).

The credential is a session JWT. The relay verifies it against the key set the control plane publishes at `<SUITE_AUTH_URL>/api/auth/jwks`, keeps that set in a five-minute cache, and answers a join from the token's claims: `apps/collab-server/src/sync/seatGate.ts` needs no database read. The owner key is gone ([ADR-0076](../../internal/decisions/open/0076-the-owner-key-is-deleted.md)), and a share link stays a separate capability for a visitor with no account. [security-model.md](security-model.md) states what that means for a deployment.

The product direction and the decisions that are settled are in [../explanation/design.md](../explanation/design.md).
