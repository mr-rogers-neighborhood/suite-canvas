# Your first workspace

This tutorial creates a small workspace, adds cards, links two of them, and checks that the work
survives a reload. Start the app first with [Run Suite locally](run-locally.md).

## 1. Create a board

Use the plus in the board tab bar to add a board. The new board is empty and selected. Board tabs
switch between boards inside the same workspace.

## 2. Add a card

Open the dock at the bottom of the canvas. The library opens on the **Cards** tab. Click a card type
to create a card on the current board.

Click the card title and type `Launch plan`. The title is rich text, so bold and italics work there.

## 3. Add a second card

Create another card and title it `Interview notes`. Put the two cards side by side by dragging one.

## 4. Link the cards

Hover the first card. A connector dot appears on its edge. Drag from that dot to the second card and
release. The link is stored as an edge with its own direction and description.

Select the link to change its path style or add a description.

## 5. Take a card off the board

Drag `Interview notes` to the library dock. The card leaves the board but stays in the workspace. It
is in the **Inbox** tab, and the **Cards** tab lists every card in the workspace.

Place it back on the board with the row menu.

## 6. Reload

Reload the page. The board, both cards, the link and the card's position come back. Move a card and
reload again. The new position persists because positions are written to the CRDT on drag stop.

## 7. Look at the model

A workspace owns its cards. A board is a view that places those cards. A card exists without a board,
which is why the library can show it after it leaves one.

The model is described in [architecture.md](../reference/architecture.md). The gestures and
shortcuts are in [add-a-feature.md](../how-to/add-a-feature.md) when you want to change them.
