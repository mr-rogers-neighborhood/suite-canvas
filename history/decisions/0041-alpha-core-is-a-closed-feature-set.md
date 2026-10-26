# ADR-0041: Alpha core is a closed feature set

- **Status:** accepted
- **Date:** 2026-10-25
- **Related:** [ADR-0017](./0017-spatial-sections.md), [ADR-0029](./0029-portal-board-field.md), [ADR-0038](./0038-a-type-template-is-a-card.md), [ADR-0039](./0039-a-link-points-at-an-endpoint-of-a-kind.md), [ADR-0040](./0040-a-board-and-a-section-are-identities.md), [ADR-0042](./0042-media-metadata-is-fields.md), [ADR-0043](./0043-a-view-is-a-lens-a-database-or-a-render.md), [ADR-0044](./0044-one-target-primitive.md), [ADR-0045](./0045-handbook-articles-are-cards.md), [ADR-0046](./0046-the-shell-derives-its-colour.md), [ADR-0047](./0047-a-view-can-be-a-card-and-an-embed-is-one-concept.md), [`docs/roadmap/alpha.md`](../roadmap/alpha.md) §7.5

## Context

On 2026-10-25 the product's author wrote down the feature set they consider the **core of the
application** and asked for it to be treated as Alpha scope. The list was held in notes, and the plan
of record disagreed with it in three places:

1. Roadmap Bet D built media as **card types**; the notes wanted metadata as **fields**.
2. ADR-0040 says boards and sections are identities, not types;
3. "Views" meant a **lens** only.

Eight further surfaces were simply absent from the docs: handbook, chat with Follow/Goto, source
annotations, tab grouping and a home board, theming with a derived shell, icons, database and render
views, and the auto-layout gesture.

## Decision

**Alpha core is a closed, written feature set.** This ADR is the list; the roadmaps own the gates and
evidence. A surface is *core* if it is named here. Anything not named here is post-Alpha work.

### Surfaces, with status at the time of writing

| Surface | Status | Governed by |
| --- | --- | --- |
| Typed cards, fields, tags, sections, references, mentions | shipped | ADR-0014, ADR-0016, ADR-0019 |
| Board tabs, library, property inspector, full-canvas card focus | shipped | ADR-0011, ADR-0018 |
| Presence: pointers, carets, drags, connector drags | shipped | ADR-0005, ADR-0009 |
| Portals: a card with a `board` field, miniature, camera transition | shipped | ADR-0029 |
| Type templates: a template is a card | shipped | ADR-0038 |
| Saved view as a **lens** over the canvas | shipped | ADR-0037 |
| Command palette and library search, both typed into immediately | shipped | ADR-0037 |
| **Links between cards, sections and boards** (endpoint kinds) | shipped | ADR-0039 |
| **Section connectors**, add/remove/move, drawn container links | shipped | ADR-0039 |
| **Connector reveal** on selection, hover, thread mode and mid-drag | shipped | ADR-0039 |
| **Thread mode** (shift-click chains links; widget-bar and connector-menu toggle) | in flight | ADR-0041 |
| **Board lifecycle**: close a tab without a prompt; library **Boards** tab; unplace or trash on delete; unplace-cards action | in flight | ADR-0040 |
| **Container inspectors**: portal and section properties, cover image, links, Locate | in flight | ADR-0040 |
| **Sketches**: renamed from Whiteboards, framed/seamless, presence "someone is in here" | in flight | ADR-0031 |
| **Arrange**: one gesture that lays out selected cards and sections | planned | ADR-0041 |
| **Links in the portal preview** | planned | ADR-0041 |
| **Collaborative drag previews** when dragging from the library | planned | ADR-0041 |
| **Auto-layout across levels** without reflowing a collaborator's board | planned | ADR-0041 |
| **Metadata as fields**, replacing media card types | planned | ADR-0042 |
| **Views: lens, database, render** over one query | planned | ADR-0043 |
| **View cards and embeds**: a card that paints a saved view, and one `embed` field (card, view, sketch, section, board) rendered by one registry | planned | ADR-0047 |
| **One target primitive** behind presence, Follow, Goto and the handbook | planned | ADR-0044 |
| **Handbook**: contextual articles on a designated board | planned | ADR-0045 |
| **Chat** with Follow and Goto | planned | ADR-0044 |
| **Source annotations**: PDF and video, projecting as cards | planned | ADR-0041 |
| **Navigation**: home board, tab grouping, pinning, outline expand and portal navigation | planned | ADR-0041 |
| **Theming** with a shell derived from the theme; icons | planned | ADR-0046 |
| **Board templates** — a gallery of ready-made boards (a board, its sections, cards and links) applied in one action, the railway.com / WordPress-patterns model | planned, **core** | ADR-0040 |
| **Collaborative schema editing**: the type editor and inspectors show who is editing | planned | ADR-0044 |
| **The paint system**: one style record over the four edges of every surface, role tokens, silhouettes, seamless backgrounds, opacity floor, text scale, wider zoom | planned, **core, first** | ADR-0051 |
| **Link routes**: manual bends in every path style, per-link layer, reverse pairs, isolate | planned | ADR-0052 |
| **Supertags**: the multi-type picker under ADR-0016's rules; tags on boards and sections | planned | ADR-0053 |
| **Fields compose**: `rating`, `group` and `list`, one level of nesting | planned | ADR-0057 |
| **Tutorials and tours**: a tutorial card, step blocks, a player overlay, Diátaxis as tags | planned | ADR-0054 |
| **Hover-peek and backlinks**: one read-only gesture over mentions, backlinks and article rows | planned | ADR-0055 |
| **Card Settings**: entity defaults, runtime-owned fields labelled in the type editor | planned | ADR-0056 |

### Board templates are core, not a stretch goal

A **board template** is a whole board captured as a starting point: its sections, the cards in them,
their types and properties, and the links between them. Applying one creates a new board, not a copy
of the current one, and never touches the board it came from. The gallery is the point — "start a book
notes board", "start a project board" — and it is the same mechanism as duplicating a board you already
have.

It is core because it is the cheapest way for a new user to get a *good* board: the blank canvas is
the hardest part of a thinking tool, and a template is how a pattern becomes reusable without asking
anyone to learn a schema. It is built on board duplication ([ADR-0040](./0040-a-board-and-a-section-are-identities.md))
rather than on giving boards a type or a body, which is why it is a planned gate and not a schema
change.

### Rules this list creates

1. **A surface on this list does not need re-approving.** Its model is already decided by the ADR in
   the third column; implementing it is execution, not a new debate.
2. **A surface not on this list is out of Alpha**, even if it appears in an older roadmap. Optimistic
   roadmaps are demoted, not obeyed.
3. **A contradiction is resolved in an ADR, not in a note.** The three above are settled by ADR-0042
   (media), ADR-0040 (containers stay identities) and ADR-0043 (views).
4. **Statuses move in one direction.** A surface may go `planned → in flight → shipped`; it may not
   quietly become planned again because it turned out to be harder than expected. If it must slip, the
   roadmap says so with a reason.

## Rejected alternatives

- **Keep the notes outside the repository.** This is how the three contradictions arose. A note that
  is not in the tree cannot be checked, and a plan nobody can check drifts.
- **Open a new stage instead of expanding Alpha.** The list is what makes the product usable for its
  author's own work; calling it "Alpha 2" would imply the current Alpha is complete when the notes
  say the core is not.
- **Decide each surface as it is built.** That is what produced a 30-item wishlist beside a 10-gate
  roadmap. The model decisions are cheap now and expensive after a schema write.
- **Promote everything to a gate immediately.** Gates need evidence; several of these need a model
  decision first (ADR-0042 to ADR-0046), so they enter §7.5 as gates with `planned` status.

## Consequences

- **`docs/roadmap/alpha.md` §7.5 is the tracker.** Gates A12–A20 carry this list with evidence.
- **Older roadmaps lose authority where they disagree.** `docs/roadmap/v2.md` Bet D is rewritten to
  metadata-as-fields; its §6.10a pins for links, arrange and sketches are replaced by a pointer to the
  Alpha gates, because those are Alpha work now, not v2 bets.
- **The author's notes can be deleted** once §7.5 exists: every item is either shipped, in flight, or
  a planned gate with a governing decision.
- **A "core feature" claim has a test.** If a proposed feature is not in the table above and not in
  §7.5, it is post-Alpha, and saying otherwise requires editing this ADR.

## Amendment 2026-10-25: the list grows by seven surfaces, and the paint system runs first

A second notes pass added surfaces that are adjacent to the ones above but not covered by them: a full
style/paint system, link routes with manual bends, multi-type supertags, composite fields, tutorials and
tours, hover-peek with backlinks, and a Card Settings surface. Each has a governing ADR in the table, so
"a surface on this list does not need re-approving" (rule 1) applies to them unchanged.

One ordering decision is recorded here because it overrides the usual sequence: **the paint system runs
first**. Its record sits on cards, sections, boards, fields and links, so every other surface either
inherits it or has to be migrated to it (the consequence ADR-0046 §Consequences already named). The gates
are A29–A34 in [`docs/roadmap/alpha.md`](../roadmap/alpha.md) §7.5.
