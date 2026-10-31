---
title: Saving and offline
description: "Why there is no Save button, and what happens when the network is not there."
order: 20
---

Every edit is a change in the workspace's log, written to this browser first and sent to the relay
second. There is no Save button because there is no unsaved state to give it: closing the tab after
a keystroke keeps the keystroke, and the status pill reports the only thing worth reporting, whether
this device's copy is durable and whether the relay has caught up.

Offline is a normal state rather than an error. The canvas keeps working, edits queue, and the pill
says how many are waiting. Reconnecting sends them; a conflict is resolved by the document's own
merge rules rather than by asking which version to keep.

Two facts about the local copy matter and are said plainly in the sync panel: where the copy lives,
and what the browser has promised to keep. A browser clears an origin's data without asking, so a
copy that is not durable is reported as such, with *Export a copy* as the one action that survives
a cleanup.

The storage ladder warns before it is a problem: a neutral line past 70% and an urgent one past
90%, each offering the same export.
