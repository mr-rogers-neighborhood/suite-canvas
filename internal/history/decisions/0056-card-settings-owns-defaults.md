# ADR-0056: Card Settings owns entity defaults

- **Status:** proposed — direction recorded, nothing built
- **Date:** 2026-10-25
- **Related:** [ADR-0016](./0016-semantic-core.md) (semantic core), [ADR-0031](./0031-whiteboard-cards-and-loro-binding.md)
  (whiteboard cards), [ADR-0029](./0029-portal-board-field.md) (the portal board field),
  [ADR-0038](./0038-a-type-template-is-a-card.md) (a type template is a card),
  [ADR-0051](./0051-one-style-vocabulary-over-edges.md) (the paint system),
  [ADR-0053](./0053-supertags-are-multi-type.md) (supertags),
  `apps/canvas/src/cards/whiteboard.ts`, `apps/canvas/src/components/TypeSettingsDialog.tsx`

## Context

The author noticed something that reads as inconsistency:

> I notice our sketch/portal types bleeding over into our cards in maybe a weird way? … if I "manage types"
> and select "Sketch", I can select seamless/framed, but its layout and options feel a bit confusing (since we
> decided that these entities are not types, I think, it feels weird). I like the idea of the use being able
> to set those defaults … but how it is now makes the user think they can make their own "Sketch Type", which
> is a cool idea but I think could contradict past decisions.

The facts are: a **sketch is a card type** (`whiteboard`, ADR-0031) whose display mode is read from a field
named `Display` on its own type; a **portal is a card** whose target lives in a `board` field (ADR-0029); a
**section and a board are identities, not types** (ADR-0040). So the type editor is showing genuine fields —
but fields the *runtime* owns, defined at seeding time with fixed names, which the user is invited to edit as
if they were their own schema.

The confusion is real, and the honest fix is not to hide the fields: it is to say who owns them.

## Decision

**Card Settings is one surface for entity defaults; the type editor shows runtime-owned fields as read-only.**

1. **Two kinds of field.** An **authored** field is one the user created and may edit or delete. A
   **runtime-owned** field is one the app reads by contract (a sketch's `Display`, a portal's `board`, a
   handbook article's subject, a view card's view reference). The field definition carries a
   `runtime: "sketch-display" | "portal-board" | …` marker, so the rule is data, not a hard-coded name list.
2. **The type editor shows runtime rows, read-only, with a link.** "Display — provided by the app. Change the
   default in Card Settings." Nothing is hidden; ownership is stated.
3. **Card Settings owns defaults**: the sketch display mode default, new-card defaults (size, shape, text
   scale — the paint values from ADR-0051), and portal defaults (size, cover behaviour). Per-card values still
   win, and a per-card override is an ordinary edit on that card.
4. **A user cannot author a new runtime contract.** Creating a type named "Sketch" is allowed as ordinary
   schema; it will not render as a sketch, because rendering reads the runtime marker, not the name. This is
   the answer to "can I make my own Sketch type": you can make a type with that name, and it will be a type —
   not a second sketch renderer.
5. **Defaults are data, not settings-in-localStorage.** They live on the workspace document, so collaborators
   see the same defaults (the same split ADR-0046 uses for themes).
6. **Deleting a runtime row is refused**, and the inspector says why; a user who wants fewer visible fields can
   hide a field per type (visibility, not deletion).
7. **Styling is not defaults.** A rule (ADR-0051/0046) styles every sketch; Card Settings decides what a *new*
   sketch looks like. Keeping those apart is what stops "defaults" from becoming a second theme system.

## Amendment — 2026-10-25: placement defaults live here too

A placement run ([ADR-0063](./0063-placement-is-a-mode-too.md)) reads four numbers, and they are settings,
not a style: the **gap** between placed cards, the **columns** a `place` grid fills before wrapping, the
**ring radius** a `web` uses, and the **padding** a run's wrapping section adds around its contents. They
belong in Card Settings beside the other entity defaults, for the same reason: one surface decides what the
next thing looks like, and a run should not invent its own spacing in a dialog nobody can find again.

## Consequences

- **The type editor becomes truthful** without gaining a concept: authored rows are editable, runtime rows are
  labelled and linked.
- **Sketches and portals stop looking like things a user defined**, which is what the author was reacting to.
- **Defaults are one place** instead of scattered through dialogs (new-card size, portal size, sketch mode).
- **The marker is additive**: existing workspaces keep their fields; the marker is added when the type is
  seeded or next written, and a missing marker simply means "authored".
- **A future runtime contract is cheap**: a new marker plus a row in Card Settings, no new editor.

## Rejected alternatives

- **Hide runtime fields from the type editor.** The user then cannot see why a sketch has a display mode at
  all, which is the confusion moved rather than removed.
- **Make sketches and portals their own object classes.** That is what ADR-0040 and ADR-0031 deliberately
  avoided: two more identities with their own placement, linking, membership and export stories.
- **Put defaults in local UI state.** A collaborator would then see a different-looking new card than the one
  whose author created it.
- **A "Sketch type" the user authors with their own renderer.** It is a plugin API wearing a type editor, and
  the render contract would have to be versioned and sandboxed.
- **Style-level defaults in Card Settings.** Rules already own "how every sketch looks"; two systems assign the
  same property and the last one to run wins.
