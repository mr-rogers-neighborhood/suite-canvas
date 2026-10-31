---
title: Tours
description: "A card of steps that plays over the board."
order: 60
targets:
  - kind: ui
    id: tour-overlay
---

A tour is a card whose body holds steps. A step names what it is about, the camera it wants, a
caption, and what advances it; playing the tour flies the camera, spotlights the step's targets and
dims everything else, with a scrubber and a way out.

A tour is one document on three surfaces. The card's own inspector authors the steps, the overlay is
the reader's view with no inspector open, and the handbook can start a tour whose steps include the
article's subject.

A step whose target no longer exists falls back to the camera it stored and says the thing is
missing, rather than silently skipping. That is the difference between a tour that has aged and a
tour that is broken.

Tours are paused in this build. The block, the schema and the overlay exist; the row that inserts a
step is not in the `/` menu while the feature is being reworked, and no part of the product
advertises it.
