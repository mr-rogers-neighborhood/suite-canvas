# Suite

**A canvas for thinking in connections.** Cards, boards and writing live in one document that works
offline, syncs when you want it, and exports to a file you own.

[**Open the app**](https://app.suite.run) · [Documentation](https://docs.suite.run) ·
[Run it yourself](#run-it-yourself)

![Suite, a board of connected cards](assets/preview-dark.png)

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

## What it does

- **Cards are objects, not text on a page.** Notes, images, links, tasks and files can appear on any
  number of boards, with their own type, tags and connections, and one edit updates every place they
  appear.
- **Boards are views.** Arrange the same cards differently for different questions instead of copying
  them. Links between cards survive being moved.
- **Rich text where you want it.** Every card opens into a full editor, with mentions, checklists,
  tables and images.
- **Works offline.** Edits land in a local database and a reload resumes where you were, with or
  without a network.
- **Share without an account, or collaborate with one.** A share link grants one board, one card or a
  whole workspace, as editor or viewer. Signing in adds live sync and presence.
- **Nothing is trapped.** Export a workspace as a single `.suite` file, and keep the recovery key
  beside it.
- **Yours to run.** The whole thing is one compose file, a relay and a static app, with no vendor in
  the path.

## Try it

The hosted app is <https://app.suite.run>. Pick a template on the launcher, or open a `.suite` file
somebody sent you. Nothing needs installing, and the canvas works signed out.

## Run it locally

Node 22 or newer, pnpm 12.13.0, and Docker for the optional database.

```sh
pnpm install
pnpm dev:env   # accounts on, session secret generated
pnpm dev:db    # Postgres, for accounts and billing
pnpm dev
```

Open <http://localhost:5173>. A second window at the same address shows live edits and presence.
`pnpm dev:env` writes a `.env` and never overwrites one; without it the app runs local-only, with no
accounts. `pnpm check:env` reports what is and is not set up, one line each, with the command that
fixes the failing ones.

[Run Suite locally](docs/tutorials/run-locally.md) covers the standalone bundle and custom ports.

## Run it yourself

Same build, no licence token, no limits:

```sh
git clone https://github.com/mr-rogers-neighborhood/suite-canvas.git
cd suite-canvas
cp .env.example .env      # set the domain, then read the file
docker compose up -d
```

[Deploy a server](docs/how-to/deploy.md) has the instance, the environment and the first boot.
[Operate a deployment](docs/how-to/operate.md) covers watching, backups and restores.

## How it is built

React 19 on a React Flow surface, one Loro CRDT document per workspace, a typed object graph validated
by Zod, and a WebSocket relay that flushes each room to SQLite. Zustand holds UI state only: document
truth lives in the CRDT and nowhere else. Presence rides an ephemeral channel and is never written to
the document.

| Path | What lives there |
| --- | --- |
| `apps/canvas` | The app: launcher, boards, cards, editor, panels |
| `apps/collab-server` | The sync relay, its stores and attachment serving |
| `apps/control-plane` | Accounts, organizations, billing |
| `packages/graph` | `@suite/graph`: the schema and the document layer |
| `services/auth`, `services/billing` | Sign-in, organizations, invitations, Stripe |
| `apps/docs`, `apps/site` | The documentation and marketing sites |
| `e2e`, `docs`, `deploy` | Playwright specs, the four documentation sections, deployment |

[Architecture](docs/reference/architecture.md) is the longer version.

## Documentation

| | |
| --- | --- |
| [Tutorials](docs/tutorials/index.md)<br>Learn by doing. | [How-to](docs/how-to/index.md)<br>One job at a time: add a feature, test, deploy, operate. |
| [Reference](docs/reference/index.md)<br>Facts to look up: architecture, limits, security. | [Explanation](docs/explanation/index.md)<br>Why the product and the code are shaped this way. |

The same pages, rendered and searchable, are at <https://docs.suite.run>.

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) is the short version and
[docs/how-to/contribute.md](docs/how-to/contribute.md) the full one; `pnpm check` is the gate a change
runs against, and [AGENTS.md](AGENTS.md) holds the rules for human and AI contributors.

Report a vulnerability per [SECURITY.md](SECURITY.md). Participation is covered by
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Licence

MIT, © Suite contributors. The hosted service and the name are not part of what you get to resell:
run the code, under your own name, and you have all of it.
