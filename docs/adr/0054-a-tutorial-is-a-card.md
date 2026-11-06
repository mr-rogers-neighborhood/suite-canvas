# ADR-0054: A tutorial is a card, and a tour is its timeline

- **Status:** proposed — direction recorded, nothing built
- **Date:** 2026-10-25
- **Related:** [ADR-0044](./0044-one-target-primitive.md) (one target primitive),
  [ADR-0045](./0045-handbook-articles-are-cards.md) (handbook articles are cards),
  [ADR-0047](./0047-a-view-can-be-a-card-and-an-embed-is-one-concept.md) (one embed field),
  [ADR-0055](./0055-hover-peek-names-an-entity.md) (hover-peek), [ADR-0038](./0038-a-type-template-is-a-card.md)
  (a type template is a card), [ADR-0051](./0051-one-style-vocabulary-over-edges.md) (the paint system),
  `docs/roadmap/v2.md` §6.7 (Scenes) and §6.8 (walkthroughs)

## Context

The author wants product-level walkthroughs, and wants the user to get the same primitives:

> A lot of this allows us to create the concept of "Tours" … We could either give the user a special layer to
> do something similar with "Tours", or they can just use walkthrough.js itself via a simplified
> interface/abstraction using the picker interface and maybe some kind of timeline scrubber/feature for
> previews and transitions etc.

> A "Tutorial" in this sense will be where a walkthrough lives, and can point to entity(s) like anything
> else. … note down our documentation for the product will follow the diataxis method, and the user will be
> provided the same tags/primitives in case they wish to adopt this method themselves or deviate.

Research on the prior art (Prezi, Figma Slides, Two Point Museum tours, Motion One, walkthrough.js,
Driver.js, Shepherd.js) produced one strong conclusion and one warning:

- **Conclusion:** every working tour model is *steps over existing things*, not a second document. Two Point
  Museum's stop is a reference to an exhibit; Prezi's step is a camera frame; Driver's step is a selector
  plus a missing-target policy.
- **Warning:** tours rot. Anchors drift, targets get deleted, and the tour then either breaks or points at
  nothing. Driver and Shepherd both ship explicit missing-target vocabulary and *no* persistence, because
  that is the honest boundary.

`docs/roadmap/v2.md` §6.7 already specified the presentation primitive — a **Scene**: a viewport, a set of
card ids, a caption and dimming, built on the camera we already have — and §6.8 already said product tours
anchor to `data-testid` with a CI test that fails when an anchor disappears. This ADR connects those to the
`Target` primitive (ADR-0044) instead of inventing a presentation engine.

## Decision

**A tutorial is an ordinary card whose body holds step blocks; playing it is an overlay over the canvas.**

1. **A tutorial is a card.** Therefore taggable, linkable, shareable, publishable, exportable, embeddable
   through ADR-0047's single embed field, and addressable as a `Target`. No new root record, no special board.
2. **A step is a block in the tutorial's body.** A Tiptap node with attributes
   `{ target: Target, viewport?: {x,y,zoom}, caption?: string, advance: "next" | "click" }`. The body is the
   timeline: reordering steps is reordering blocks, and narration is ordinary rich text with the same inline
   mentions, icons and formatting as any note.
3. **Authoring is the picker plus the timeline.** "Add a step" turns the next interface click into a `Target`
   and stores the current viewport with it. A click-recorder is explicitly a later addition; hand authoring is
   what makes the first version teachable.
4. **Playback is an overlay, not a mode switch.** A compact player offers back/next, a scrubber, and the
   caption; the camera flies to the step's viewport, the target is outlined and spotlit (the same rendering
   the handbook uses, ADR-0045), and everything else dims. Escape leaves the tour and restores the viewport it
   started from.
5. **Anchor = target *and* stored viewport.** The target is what is pointed at; the viewport is what the reader
   sees if the target is gone. A step whose target no longer resolves degrades to its viewport and shows a
   tombstone ("this was removed") instead of breaking the tour.
6. **Linear by default, with an optional jump.** A step whose target is another tutorial links to it. No
   branching editor in the first version.
7. **`advance: "click"`** makes a step wait for the reader to actually press the thing it points at — the
   "learn by doing" primitive, and the only step type that proves the reader did something.
8. **Cross-board stops are allowed**, because a portal is a `Target` and the camera already knows how to enter
   one.
9. **Completion is per reader, per tutorial, stored on the tutorial card** (a workspace record, not
   localStorage), so finishing survives a reload and a collaborator can see "read". A re-published tutorial
   with more steps re-opens for readers who had finished it.
10. **Our own docs use the same mechanism.** Product tours are tutorials on the handbook/docs board whose
    targets are interface anchors (`data-testid`). A CI test fails when a shipped tutorial names an anchor
    that no longer exists — the only real defence against tour rot.
11. **Diátaxis is four tags**, not four types: `tutorial`, `how-to`, `reference`, `explanation`. A Docs board
    template seeds a board using them; a user who prefers another taxonomy adds their own tags and ignores
    ours. We do not ship a docs CMS: no routes, slugs or site trees (the design-inspirations non-goal stands).

## Consequences

- **No presentation engine.** Scenes (v2 §6.7) become what a step stores, and the camera work already exists.
- **Tutorials are content, so they inherit every other feature** — search, mentions, backlinks, sharing,
  export, lenses. A hand-rolled tour format would inherit none of it.
- **A tutorial is editable by several people** because it is a card in a CRDT; two people can add steps
  without conflict, and the same presence rules apply.
- **The player must be reachable from three places**: the dock/library, a portal's panel ("this board's
  tour"), and a shared link.
- **Tour rot is a test, not a promise.** Shipping a product tour means an anchor test ships with it.
- **A step is not a slide.** There is no slide layout, no transition library, and no export to a deck; the
  author's Motion/PowerPoint references are about *feel* (camera easing, dimming), not a second authoring
  language.

## Rejected alternatives

- **A `tours` root record scoped to a board.** A second document shape that cannot be tagged, mentioned,
  linked, shared or embedded, for no gain over a card.
- **A board *is* the tour** (each card a slide). It fights the spatial model — a board is a canvas, not a
  sequence — and it would make "tour" mean two things.
- **Importing walkthrough.js.** jQuery, absolute pixel positioning, no missing-target policy, unmaintained
  since 2022; the model is borrowed, the code is not.
- **localStorage completion.** It would be invisible to collaborators and lost with the browser profile.
- **Automatic behaviour branches ("if the reader clicked X, jump to Y").** A graph editor in a first version;
  `advance: "click"` gives the same teaching value for one step.
- **A recorder in the first version.** Recording clicks produces steps with no narration and no viewport
  intent, which is exactly what makes tours feel machine-made.

## Notes for the reader of the code

The rendering pieces this reuses already exist: `targetOfFocus()` and `planNavigation`
(`apps/canvas/src/canvas/navigateTarget.ts`), the camera transition in `CanvasBoard.tsx`, and the
outline-and-point rendering specified for the handbook (ADR-0045 §4, generalised by ADR-0055).

## Amendment 2026-10-25: several targets per step, and presenting from the card's own panel

§2's `target` becomes **`targets: Target[]`**, at least one, and the **first is primary**. A step may
need to point at "these three cards form a group" or "the connector and the section it lands in"; a
consumer that needs exactly one target — an outline, a badge, the dead-target tombstone — reads
`targets[0]`. This is recorded before the first tour is authored, because a step's attributes live
inside a card body, so widening later would be a content migration across every tutorial.

§4's player is **a mode of the tutorial card's own inspector panel** (Details · Steps · Style), not a
separate player surface: presenting shows the current step, previous/next, a scrubber and the caption
in the real rich-text editor. The **author may edit a caption while presenting**; a reader without edit
rights sees the tour **read-only**, and the panel's editing surface never appears in a share. The
reading surface itself is the overlay, which needs no inspector open.

Everything else here stands: a tutorial is still a card, a step is still a block, and the anchor test is
still the defence against rot. The three surfaces and the state split are recorded in
[ADR-0058](./0058-a-tour-is-one-document-on-three-surfaces.md).
