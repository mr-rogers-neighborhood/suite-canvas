# Suite Canvas

**A canvas for thinking in connections.** Cards, boards and writing live in one document, on your
machine, in a file you own.

![layout.gif](https://i.imgduck.com/u/v8jzuR.gif)

> **Alpha.** Canvas is the most developed app in the suite and still changes shape. Keep the file
> somewhere you back up, and expect to export rather than rely on it.

---

Developer note:

**What is Suite?**

Suite is a collection of applications, a relay for sync and collaboration, and a toolbox for updating and managing your applications.

This architecture came from trying basically every application worth trying in its respective space and being left wanting. I can't claim to have replaced these applications, but I'm building my own that provide the feature sets I need. They're released open-source under the MIT license, local-first, and easy to install and manage from your own computer. Mobile applications are out of scope for now, but will come once there's a solid foundation. If these applications are useful to you, you're free to use them however you'd like, or fork and develop them into your own suite.

Applications I've tested in the past include knowledge management tools and outliners such as Obsidian, Notion, Capacities, Heptabase, Tana, Logseq, and AnyType. They also include planners and task management tools such as Sunsama, Akiflow, Todoist, and TickTick, as well as budgeting applications such as YNAB and Actual.

Each of these has something going for it that the others don't, and every one is missing a critical set of capabilities I'd want from that kind of application: a simple, local-first, integrated sync service, and flexible, deep collaboration features. Some are free and open-source, even local-first; others are tied entirely to the cloud and an internet connection. None contain the exact set of capabilities I want for a visual note-taking and research application.

That led to Suite Canvas, originally the only application in the collection. Suite Canvas combines the typed-object-graph model from apps like Capacities with the canvas-driven, research-oriented experience of Heptabase. It takes smaller influences from other applications on the list, and from some that aren't (such as a generalized version of Tana's Supertags). It's the most mature of the bunch, though still very much in alpha.

I've tried to build something like Canvas several times, and each attempt hit scope creep or a design wall that led me to abandon or restart it. Approaches that didn't work out:

- **Canvas as a CMS.** A tool for thinking always becomes constrained by the language and thought process of web design. People don't think in routes or views, and mashing the two languages together produced something confusing and not worth using. Adding mapping between the CMS and the canvas didn't help either (I carried over, and still maintain, many architectural ideas from WordPress plugins like Advanced Custom Fields, Metabox, and Pods). It was clunky and felt like using two separate applications that don't mix.
- **Infinite canvas.** It seems ideal, and I love the infinite-zoom drawings people make. I tried ICE, an experimental canvas engine, and PixiJS. Both looked striking and had genuinely impressive features (ICE let you arrange cards fractally, for example), but they were complexity tar pits that forced the entire application design to contort around them. That's before getting into accessibility, sync and collaboration, and also navigation: it predictably makes it very easy to get lost. Good for art, not clear that it is good for a structured thinking tool. I did end up integrating excalidraw, via the "Sketch" card type and embed, so you maintain the important bit of being able to draw and sketch on an infinite canvas, and then embed it in your non-infinite canvas. I also added the "Portal" card type, a way to link from one canvas board to another. These were more comprehensive and easily justified expansions.
- **No-code/low-code systems and computational notebook features.** These seem ideal too, but they cause both classes of problems above and worse ones. You lose the ability to arbitrarily rearrange your thoughts, because your links and cards now mean something beyond simple data. The result can be as striking as an infinite canavas (I even had links animate to show you the data-flow directly), but in my attempts it wasn't useful, just looked cool.

None of these experiments were pointless. Each revealed insights I didn't have before and taught me something about software design.

Suite Planner, Suite Budget, and the surrounding tooling (Suite Start and Suite Sync) came from realizing I can't fit all of these application types onto a canvas interface. I tried, and hit the the third design wall mentioned above. It was too complex, too deep, and too over-engineered to be functional and usable, let alone shippable.

So the applications are split into three that match their domains. A canvas is a thinking and research tool. A planner is a task, project management, and calendaring tool. A budget is a budgeting tool. I plan to experiment with integrations (embedding your calendar or budget into your canvas, or attaching your canvas to your calendar or budget, for example), but those features need to be considered deeply to actually be useful.

In the end, you should have a canvas, a planner, and a budget: all simple and easy to use, all with integrated and easy-to-run sync and update services, and none of them requiring you to connect to a centralized server or cloud service to use, at all. That's what will make Suite pretty sweet.

---

## What it does

- **Cards are objects, not text on a page.** Notes, images, links, tasks and files can appear on any
  number of boards, with their own type, tags and connections, and one edit updates every place they
  appear.
- **Boards are views.** Arrange the same cards differently for different questions instead of copying
  them.
- **Rich text where you want it.** Every card opens into a full editor, with mentions, checklists,
  tables and images.
- **Works offline, always.** The document is a CRDT in this app and a file on disk. There is no
  account to sign in to and nothing to reach.
- **Sketch and link.** A Sketch card is an Excalidraw drawing embedded on a board; a Portal card
  opens another board.
- **Nothing is trapped.** Export the workspace as one `.canvas` file and keep it beside whatever you
  already back up.

## Run it

Node 22 or newer, and pnpm 12.13.0.

```sh
pnpm install
pnpm dev            # the renderer, at http://localhost:5173
```

The browser build runs the whole app against local storage, which is the fastest way to work on it.
The thing that ships is the desktop app:

```sh
pnpm dev:desktop    # Electron shell around the same renderer
pnpm --filter @suite/desktop package:dir   # an unpacked binary in apps/desktop/release
```

## How it is built

React 19 on a React Flow surface, one Loro CRDT document per workspace, a typed object graph validated
by Zod, and an Electron shell that owns the file. Zustand holds UI state only: document truth lives in
the CRDT and nowhere else.

| Path | What lives there |
| --- | --- |
| `apps/canvas` | The renderer: launcher, boards, cards, editor, panels |
| `apps/desktop` | The Electron shell: the file, the lock, the window, packaging |
| `packages/graph` | `@suite/graph`: the schema and the document layer |
| `packages/import-obsidian` | Reads an Obsidian vault into a document |
| `e2e` | The Playwright suites, including the desktop one |
| `docs/adr` | Every architecture decision, dated |

It stands on other people's work, and each is worth a look on its own: [Loro](https://loro.dev) for the
document, [React Flow](https://reactflow.dev) for the surface, [Tiptap](https://tiptap.dev) for the
editor, [Zod](https://zod.dev) for the schema, [Excalidraw](https://excalidraw.com) for the sketch.

[Architecture](docs/reference/architecture.md) is the longer version, and
[the conventions](docs/explanation/suite-conventions.md) say what Canvas shares with the other apps —
and what it deliberately does not.

## Documentation

| | |
| --- | --- |
| [Tutorials](docs/tutorials/index.md)<br>Learn by doing. | [How-to](docs/how-to/index.md)<br>One job at a time: add a feature, change the model, test. |
| [Reference](docs/reference/index.md)<br>Facts to look up: architecture, the data model, the desktop plumbing. | [Explanation](docs/explanation/index.md)<br>Why the product and the code are shaped this way. |

## Working on the whole suite

Canvas is one of three apps beside a hub and a sync service, and they are developed together from
[`suite-dev`](https://github.com/mr-rogers-neighborhood/suite-dev), which assumes the repositories are
cloned side by side. It stages the real binaries, runs the hub, and owns the cross-app end-to-end
suite, and that repository's own `preflight` script says what is missing.

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) is the short version and
[docs/how-to/contribute.md](docs/how-to/contribute.md) the full one; `pnpm check` is the gate a change
runs against, and [AGENTS.md](AGENTS.md) holds the rules for human and AI contributors.

Report a vulnerability per [SECURITY.md](SECURITY.md). Participation is covered by
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Licence

MIT, © Suite contributors.
