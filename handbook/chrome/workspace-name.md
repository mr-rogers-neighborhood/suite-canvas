---
title: The workspace name
description: "Rename the workspace, pin it, switch to another one, or go back to the launcher."
order: 30
targets:
  - kind: ui
    id: workspace-name
---

The workspace name is a menu, not a label. A press renames in place; a right-click opens the same
actions where the pointer is, for a reader who would rather not hunt for the menu button.

The menu holds four things: **Rename workspace**, **Pin workspace to top**, the other workspaces
this browser has open lately, and **Back to launcher**. Boards and workspaces are the same
question — "where am I" — which is why switching one is here rather than only in the launcher.

Pinning a workspace is the smaller promise a board pin makes: it lifts the workspace to the top of
that list and of the launcher's recents. It earns no tab, because the tab strip belongs to the
board you are on.

Renaming is a document write, so it is refused for a reader who cannot write, and the refusal is
shown under the field rather than swallowed. Going back to the launcher asks nothing: work in a
signed-in workspace is already saved, and a prompt could not change that.
