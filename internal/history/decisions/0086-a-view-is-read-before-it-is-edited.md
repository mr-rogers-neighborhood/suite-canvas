# ADR-0086: a view is read before it is edited, and picking is a projection

Status: accepted, 2026-10-31. Amends ADR-0043 and ADR-0085.

## Context

ADR-0085 separated a view into three things: a configuration the workspace shares, a layer that takes the
window to read it, and a projection this reader casts on their own board. The layer that shipped with it had
one state. Every control was present at once, every cell was an input, and building a context was a fourth
surface with its own bar. The result read as a form with a table under it, which is the opposite of what a
view is for: a view is a way to *look* at a workspace.

Two symptoms pointed at the same cause. The projection bar sat at `bottom: 16px; left: 50%` with a lower
z-index than the dock, so it spent its life half behind it: a reader state drawn as chrome. And picking cards
took the layer away to replace it with a different bar, so "build a view" and "read a view" looked like two
features.

## Decision

**A view is read before it is edited.** The layer has a mode: `read` (the default) draws the presentation and
nothing else, with the context said in one sentence and cells as values; `edit` is the same surface with its
controls. A new draft always opens in edit. The mode is reader state, never written, so one person editing
does not turn anyone else's view into a form.

**Picking is a projection.** `Pick cards` casts the view over the board and leaves the layer, and a card press
pins or unpins through `pickCard`. The projection float owns the bar for the duration, and Cancel restores
the pin list the pick started from. Building a context and reading one are the same surface, because they
are the same act at different moments.

**The projection is a float, not a bar.** It drags through `useFloatGesture`, settles around `shellObstacles`,
and remembers its corner per workspace beside the projection. A reader state that a reader can move is a
reader state the app does not have to place for them.

**Drill-down is a reading.** Pressing a group header or a chart bucket narrows this reader's surface to it.
Writing that to the view would silently change a shared configuration because somebody looked at a bar.

**A view's lifecycle belongs in its rail.** `duplicateView` is new, and `deleteView` — which existed with no
caller since the layer pass — is offered as a two-press button with an Undo in the footer. A view is one
record, so a confirm dialog would be heavier than the mistake.

**A presentation can be a place.** `board` joins the collection modes: the cards where they sit, drawn through
`BoardMiniature`, with unplaced ones named underneath rather than given an invented position.

**Grouping is one control, and it is presentation.** `query.groupBy` is a facet or `{ field }`, and
`groupViewResult` buckets the ids the query already returned.

## Consequences

- The library stops copying a view's query into its own filter state. `activeViewId`, `applyView` and
  `exitView` are gone: opening a view opens the layer on it. A copied query was a second representation of one
  selection that could only drift.
- `styles/views.css` is a stylesheet rather than an entry animation, and `views/chip.tsx` is the one chip and
  one segmented control. Eleven copy-pasted class strings across four files were four chips waiting to
  disagree.
- The chart's `line` layout is a path with dots and an axis. It was a list of numbers.
- `views.projection-bar` is now `views.projection-float` as a documented region, and the handbook article
  describes both the float and its picking state.
- Nothing about the configuration/state line changed. Every item here is decided by one test: if the change
  would alter what another person sees, it is an Edit-mode document write; if it only alters what this reader
  is looking at, it is theirs.

## Open

- **Presence in the layer.** Two people in one view is the one place a "someone else is editing this" note
  would be cheap and useful. Not built.
- **The `view` field kind** stays unwired, for the reason ADR-0085 gives.
- **Cell kinds beyond text, number, checkbox and select.** The table writes through now, so each one is a
  registry entry rather than a rewrite.
