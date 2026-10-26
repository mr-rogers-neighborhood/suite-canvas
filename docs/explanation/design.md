# Design direction

Suite is a local-first, collaborative tool for thinking. The canvas is where ideas are arranged, and
the workspace is the set of objects those arrangements are made of. Someone should be able to open
the app offline, think in spatial structures, share a piece of it without handing over the whole
workspace, and never feel that they are filling in a website.

The north star in one sentence: cards are objects, boards are contexts, and every published or
computed representation is a projection of the object graph, never the place the graph is authored.
That sentence settles most of the arguments below, because it names what the source of truth is and
what may be recomputed.

Three pages divide this work. A settled choice with its alternatives is a decision record, indexed in
the internal decision log. A sequenced plan with gates and evidence is the internal roadmap. The
full design reference this page condenses, including the questions since answered and the surfaces
since withdrawn, is kept with the internal history. This page is the authority for the direction.

## The product

A feature has to help thinking, survive collaboration and offline use, and stay out of the stored
facts if it can be recomputed from them. Those three questions come from the north star, and they
reject more proposals than they admit.

| Ruled out | Because |
| --- | --- |
| Routes, slugs, page trees or templates as card properties | A card can appear on five boards, in two views and on one website without knowing about any of them |
| A board that owns its cards | "Remove from board" is not "delete"; a board shows objects that exist without it |
| A mandatory folder tree | Organisation is spatial, typed and queryable, and hierarchy is optional navigation |
| Server-authoritative documents | The relay persists and authenticates, and the document belongs to the clients |
| One uniform node type | It makes "object" and "placement" ambiguous, which is the ambiguity the board and card split removes |

## The shell

The shell keeps retrieval one gesture away and stays out of the canvas's way instead of surrounding
it with chrome.

| Surface | What it does |
| --- | --- |
| Library dock | Finds objects that are not in front of you, and creates new ones |
| Drawer | The library itself: inbox, cards and trash, with facets. A sections facet appears only when the drawer is scoped to one board, because a section title means nothing outside its board |
| Board tabs and a home board | Moving between boards must not feel like opening a document |
| Outline rail | The active board's section tree in reading order, with counts and peer presence. It is a table of contents, never a filter |
| Inspector | One panel driven by the selection; a drawer row opens the same panel, so a property can be fixed without going to the canvas, and no row grows an editor of its own |
| Card header chrome | The card's own controls live inside the card, so the canvas has one layer of chrome instead of a floating toolbar per node |

Four interaction rules follow and are easy to break. Selection and view state are UI state, never
document state. Drags persist on release, while live positions ride presence. Creating a card focuses
its title, so a new card starts as writing. A destructive action names its scope and offers the
non-destructive path first.

## The vocabulary

These words are load-bearing, because each names a different scope.

| Term | What it is | Scope |
| --- | --- | --- |
| Workspace | The collaboration and storage boundary | Workspace |
| Board | A named context that shows placements of cards and does not own them | Workspace |
| Card, or object | A thing with identity, types, fields, tags and body content, existing without any board | Workspace |
| Placement | Where a card sits on one board: position, size, layer, at most one per board and card | Board |
| Type | The schema-bearing classification: fields, defaults, affordances | Workspace |
| Field and property | A typed definition owned by a type, and the value of that field on one card | Workspace, card |
| Tag | A freeform label with no schema, for retrieval rather than validation | Workspace |
| Reference | A derived fact that A mentions or points at B, from an `@` mention or a card-valued field | Workspace |
| Section | A named spatial region on a board, with membership derived from the card's header anchor | Board |
| View | A saved, read-only query rendered as a list, table, gallery or board | Workspace |
| Template | A creation recipe for a type, instantiated and never linked | Workspace |

### Type, tag, section, view

| Question | Type | Tag | Section | View |
| --- | --- | --- | --- | --- |
| Defines schema? | Yes | No | No | No, it filters schema |
| How many per card? | One primary plus supertags | Many | At most one per board | Not applicable |
| Where does membership come from? | Explicit assignment | Explicit assignment | Geometry inside the board | Query evaluation |
| Stored on the card? | Yes | Yes | No, derived | No, derived |
| Can it change behaviour? | Yes: forms, templates, dashboards | No | No, visual grouping only | No, results are read-only |

A type answers "what is this?", a tag answers "what else is this like?", a section answers "where is
it on this board?", and a view answers "which cards match this question?". The answers differ, which
is why none of the four is implemented as a special case of another.

## Truth, presence and rooms

The Loro document is the truth, and every client observes and mutates it while the UI keeps no
writable copy. Gestures do not write facts: pointer, drag, marquee, connector and link movement
travel over `EphemeralStore` channels with a time to live, so a dropped connection cannot leave a
ghost drag behind, and a release is the moment a position is persisted.

Presence is scoped by room, which is why the sharing boundary and the presence boundary are the same
boundary. The product runs one room per workspace today. A per-card room would let a share grant access to one
card's content and a redacted summary, while the workspace index stays private, because the index
holds every title and property in the workspace and handing it to an outside viewer would leak all
of it.

Sharing takes the other route for now: a live projection room over a redacted, self-contained copy,
extended to selections. The index is never shared, the copy is live, and both are decided in
ADR-0022 and
ADR-0023.

## The inspirations

Each row is a borrow and a refusal. The refusals carry the weight, because copying a tool would have
imported its assumptions about what a document is.

| Source | Borrow | Refuse | Why |
| --- | --- | --- | --- |
| Heptabase | Card library plus whiteboards, one card on many boards, sections, sub-boards, card info and backlinks, arrows with descriptions, `@` mentions | Board-owned cards, a mandatory document tree, a link-type registry | Objects come first and spatial contexts second; meaning lives in names and mentions, so a type picker per arrow is a decision nobody should have to make |
| Tana | Supertags as typed objects, typed fields, saved queries, keyboard-first capture | A single uniform node type, implicit graph semantics | A type has to be light enough to apply while writing and strong enough to drive fields and queries |
| Obsidian Semantic Canvas | Canvas groups, labelled links, a deliberate canvas to note projection | Continuous two-way property sync on every move | Projection is an explicit command; a background sync that rewrote cards would edit them without anyone asking |
| Obsidian Metadata Menu | Typed field definitions, presets, per-type field sets | Frontmatter as the schema, per-file ad-hoc schemas | Field definitions belong to the workspace, so a file convention cannot carry them |
| Capacities | Object types, object dashboards, backlinks, collections | Daily-note navigation as the shell, cloud-only assumptions | Object dashboards are the retrieval layer we want, while the shell stays canvas-first |
| Obsidian Advanced Canvas | Silhouettes and border styles as paint, zoom breakpoints that stop drawing detail, z-order controls | Obstacle-avoiding routing by default, shapes that hold content, floating edges | A line that re-routes itself under the reader is the failure those fences prevent, and a silhouette that moved an anchor would be a container |
| Prezi | A presentation as a path of camera frames on one spatial document, and the zoom-out-to-overview beat | Long flights as the default transition, frames as the only structure | A tour step stores a path of frames; easing and dimming are ours to bound, because vestibular discomfort is the top complaint about the source |
| Figma Slides | One artefact with two modes, spatial authoring and linear playback over the same canvas | Slide-as-frame as the only unit | It shows that bird's-eye editing and linear playback both come from one document |
| Two Point Museum | A tour stop is a reference to a real object, and the route previews in stop order | A tour as a single-save route with no branching | The content already exists, so a tour is an ordering over it and needs no second document |
| Motion One and motion.page | Timeline, keyframes and a scrub-able position as the authoring vocabulary | Scroll-linked triggers, pinning, a web animation runtime | We animate a camera, and the authoring feel we want is steps on a timeline |
| walkthrough.js, Driver.js, Shepherd.js | The missing-target vocabulary: skip, wait, advance on click, with completion stored by the app | jQuery, absolute pixel positioning, local-storage completion | Tour rot is the real failure mode, so a step stores a target and a viewport, and our tours ship an anchor test |
| Diátaxis | Four reader needs, tutorial, how-to, reference and explanation, as a tag taxonomy | A document tree, routing or a CMS | The method's discipline arrives without its site structure, and the same tags then work on a card (ADR-0054) |
| Page-builder style systems (ACSS, Core Framework, Advanced Themer, GeneratePress) | A small top rung of global controls, a variable layer with named utilities from one source, kits that travel between projects, a searchable index that says which rung owns each utility and what removal falls back to | Stylesheets authored as CSS, class lists as meaning, per-breakpoint style matrices, a token editor with an infinite settings tree | A style here is a value on a record: collaborative, undoable, per-card and derived downward, never a stylesheet (ADR-0071) |

The synthesis takes GeneratePress's restraint at the top rung, ACSS's one-source variable and utility
split, Core's portable kits and Advanced Themer's catalogue discipline, then leaves behind their
central assumption. Each of those tools renders a preview because its subject lives elsewhere. Ours
is on the canvas: the thing being styled is the thing you are looking at.

## Design principles

| Rule | What it means |
| --- | --- |
| Derive unless storage is required | Home board, section membership, view results, backlinks and display titles are computed. A stored copy is a cache with an invalidation problem, and caches are allowed only when they can be discarded and rebuilt |
| Write at field granularity | A property update writes one `properties` key, a section move writes `x` and `y`, a tag add writes one key. A whole-record write makes unrelated concurrent edits resolve last-write-wins for everything, silently |
| Put meaning in names | A field called "Contradicts" says what a link-type registry would say, without a decision per link and without constraints to maintain. References come from mentions and card-valued fields, and backlinks derive from them |
| Make projection explicit | Applying a section or a view as tags, promoting a selection into a view, publishing a card: each is an idempotent command that reports what it changed. No live loop rewrites cards because layout moved |
| Keep presence ephemeral | Pointer, drag, marquee, connector and link gestures ride Loro `EphemeralStore` channels and expire on their own, while positions persist on release. A dropped connection must not leave a ghost drag |
| Stay canvas-first | The shell is a dock, a drawer, board tabs, an outline rail and one inspector. Selection and view state are UI state and never document data |
| Give each concept one owner | One inspector, one style vocabulary, one `Target` primitive, one placement mode, one escape ladder. A second surface for a concept that already has one is a bug in the model |
| Treat performance as a feature | The budgets are 60 fps with around 200 visible cards, no long tasks over 50 ms, zero persisted writes during a gesture, and under one frame from input to painted movement. Instrument first, take the cheap wins, and split documents only when measurements demand it |
| Publish outside the core | The core stores cards, types, fields, references, boards, placements and sections. Routes, slugs and navigation belong to a publication, and the pipeline reads a deterministic versioned bundle |

The field-granularity rule is the one that looks like a preference and is not. Concurrent edits merge
per field, so a whole-record write turns every unrelated change into a conflict that resolves
invisibly. That is also why a section drag writes coordinates and never card state.

## Current and target

The direction is stable; the distance to it is not. Current ships today, and target is decided and
unbuilt.

| Area | Today | Target | Why the gap is deliberate |
| --- | --- | --- | --- |
| Documents | One Loro document per workspace | An index document plus per-card documents | The split buys isolated loading and per-card access control and costs cross-document atomicity; the benchmarks must ask for it first, and it stays a storage change behind one seam |
| Rendering | React Flow is the only canvas the product ships | No second engine claimed | A continuous derived scene was built and withdrawn; portals went back to being doorways |
| Portals | A card with a `board` field, a live miniature, a camera transition, with the root board still active | Nothing further in Beta | The live scaled instance needed the withdrawn scene, and the data model never depended on it |
| References | A derived index from mentions and card-valued fields | Unchanged | Typed relations were rejected in favour of references, because a relation store would be a second truth |
| Views | Saved queries over text, types, tags, sections and board scope | Lens, database and render kinds over one query object | The three kinds are a presentation split, and the query has to settle first |
| Sharing | A live projection room over a redacted copy, extended to selections | Per-card access control as the unit | A per-card room needs identity, and identity is the account layer |
| Accounts | An ownership layer in progress: sign-in, passkeys, claim-on-sign-in, the control-plane schema | The account owns workspaces, with invitations and billing | It is the Beta recovery story (ADR-0065, ADR-0067), and it adds a store and a second restore path |
| Publishing | No publishing surface, so routes, slugs and templates are absent from the model | A deterministic bundle read by a separate publishing app | Publishing stays outside the core, so a card that moves between boards cannot break a URL |

### What the split would cost

Splitting the document buys isolated loading and per-card access control, and gives up atomicity.
Loro has no multi-document transaction, so each cross-document operation becomes a convergent
sequence: create the index summary before the card document, retain the body on trash, and tombstone
before purging, so a crash leaves an orphan that a sweeper removes instead of a listed card with no
body. Undo also splits by scope, with structural undo in the index and text undo in the card, and the
interface has to say which one a keystroke will undo.

That cost is acceptable because the model already treats cards as independent objects. It is still
the reason the split waits for a benchmark, since preference is not evidence.

### What was tried and withdrawn

A continuous derived scene was built and then removed. It rendered nested portals as live scaled
instances, with an outline and camera checkpoints over one document, and it was a read-only preview
with no editing path. The portal data model did not depend on it, so the canvas returned to doorways.
The lesson stays on the page: a future attempt has to arrive with an editing story.

## Anti-patterns

- Stored view results, or stored section membership.
- A whole-record write because one field changed.
- A projection loop where dragging a card into a section rewrites its tags.
- A link-type registry that asks the author to classify every arrow.
- A second inspector, toolbar or layer-mode surface for a concept that already has one.
- Shapes that contain cards, when sections already contain them and a silhouette is paint.
- Type inheritance, when supertags plus a field union express a family and a class.
- A plugin API or a tour recorder before the underlying authoring works.
- Server-authoritative document state, or a central search index that conflicts with per-card access
  and offline availability.

## Open questions

Some questions in the source document have since been answered, and the remainder are listed here so
nobody resolves them by implication.

| Question | Where it stands |
| --- | --- |
| Board-level sharing | Answered: a live projection room over a redacted copy, extended to selections |
| Multiple supertags | Answered by ADR-0053: a primary type carries presentation and the others union their fields |
| Section overlap and nesting | Answered by ADR-0017: the smallest containing header anchor wins, and nesting follows containment |
| Exact metadata split | Open: title, types, tags and scalars in the index, body in the card document, with a rule still needed for excerpts and embeds |
| External share semantics | Open: revocation, transitive visibility, and whether a viewer sees the titles of unshared neighbours |
| Search | Open: an in-memory index over summaries first, with body search loading card documents, because a central index conflicts with per-card access and offline availability |
| Card document retention | Open: trash retains the document and purge tombstones first, while an offline client may still resurrect a purged document |

The answered rows point at the record that settled them. The open rows are what this page refuses to
settle by implication.

## Using this page

Judging a feature takes five questions. Does it help thinking? Does it survive collaboration and
offline use? Is it stored, or can it be derived? Which word in the vocabulary does it change, and
does it stay inside that word's scope? What does it move between stored and derived? A proposal that
cannot answer the last two is not a design yet.

The facts behind these claims, the layer map and data flow and the document model, are in
[reference/architecture.md](../reference/architecture.md). The arguments are in
the internal decision log, and the sequence that produces the evidence is the internal roadmap.
