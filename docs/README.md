# Suite documentation

Suite is a local-first, collaborative canvas. A workspace owns its cards; boards are views of those
cards. The document is a Loro CRDT, every write is validated in `@suite/graph`, and the canvas works
offline.

Current line: **alpha, 0.1.0-alpha.1**. The release is real and the product is early: expect rough
edges. [CHANGELOG.md](../CHANGELOG.md) lists what each version changes.

## Four ways in

| | |
| --- | --- |
| [Tutorials](tutorials/index.md)<br>Learn by doing. One guided path to a first success. | [How-to](how-to/index.md)<br>One task at a time: test, deploy, operate, release, contribute. |
| [Reference](reference/index.md)<br>Facts to look up: the model, commands, limits, security boundary. | [Explanation](explanation/index.md)<br>Why the product and the code are shaped this way. |

Start with [Run Suite locally](tutorials/run-locally.md) if this is your first checkout.

## Two entrances

The docs site has two front doors, because it has two readers.

| Entrance | Source | For |
| --- | --- | --- |
| Developer documentation | `docs/` (this page's tree) | Building, running, deploying and changing Suite |
| User handbook | `handbook/` | Using the interface: one article per element, menu, system and sub-system |

`docs/` stays developer documentation and never bleeds into the handbook; `handbook/` is the same
Markdown the app's own handbook shows, so an article written for a reader of the product is also a
page of the site. The portal at the site root links to both, and neither appears in the other's
sidebar.

Each section index lists its pages newest first. The docs site adds full-text search, a tabbed
dashboard, and LLM endpoints:

```sh
pnpm docs:site        # http://localhost:3001
pnpm docs:site:build  # production build
```

`/llms.txt` is the summary an agent reads first, `/llms-full.txt` is every page in both spaces, and any
page is available as Markdown by dropping the trailing slash from its URL and appending `.md`.

## Elsewhere in the repository

The root [README](../README.md), [AGENTS](../AGENTS.md), [CONTRIBUTING](../CONTRIBUTING.md) and
[SECURITY](../SECURITY.md) cover setup, contribution and vulnerability reporting. An `ADR-NNNN`
reference is shorthand for a design decision; the reasoning is always restated in the prose beside it,
so no page here needs the record to be readable.
