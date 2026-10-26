# Suite documentation

Suite is a local-first, collaborative canvas. A workspace owns its cards; boards are views of those
cards. The document is a Loro CRDT, every write is validated in `@suite/graph`, and the canvas works
offline.

Current line: **Beta, 0.2.0-beta.1**. The release is real; the Beta exit gates are not all closed.
The gate status is tracked in the internal roadmap.

## Four ways in

| | |
| --- | --- |
| [Tutorials](tutorials/index.md)<br>Learn by doing. One guided path to a first success. | [How-to](how-to/index.md)<br>One task at a time: test, deploy, operate, release, contribute. |
| [Reference](reference/index.md)<br>Facts to look up: the model, commands, limits, security boundary. | [Explanation](explanation/index.md)<br>Why the product and the code are shaped this way. |

Start with [Run Suite locally](tutorials/run-locally.md) if this is your first checkout.

Each section index lists its pages newest first. The docs site adds full-text search, a tabbed
dashboard, and LLM endpoints:

```sh
pnpm docs:site        # http://localhost:3001
pnpm docs:site:build  # production build
```

`/llms.txt` is the summary an agent reads first, `/llms-full.txt` is every page, and any page is
available as Markdown by dropping the trailing slash from its URL and appending `.md`.

## Outside this tree

`internal/` holds the decision records, the programme documents, and the design reference. It is
local-only, not part of this tree, and not published.

The root [README](../README.md), [AGENTS](../AGENTS.md), [CONTRIBUTING](../CONTRIBUTING.md), and
[SECURITY](../SECURITY.md) cover setup, agent rules, contribution, and vulnerability reporting.
