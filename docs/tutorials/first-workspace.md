# Your first workspace

This tutorial creates a small workspace, adds cards, links two of them, and checks that the work
survives a reload. Start the app first with [Run Suite locally](run-locally.md).

## 1. Create a board

The board tabs sit at the top. The control at their right opens a menu; choose **New board**. The new
board is empty and selected, and the menu lists every other board in the workspace.

## 2. Add a card

The dock is the floating toolbar at the bottom centre. **New card** opens a menu of card types; choose
**Note**. The card is created at the centre of the viewport and its title is focused for typing.

Click the card title and type `Launch plan`. The title is rich text, so bold and italics work there.

**Library** in the same dock opens the drawer, which lists every card in the workspace and offers the
same types.

## 3. Add a second card

Create another card and title it `Interview notes`. Put the two cards side by side by dragging one. The
live position follows the pointer; the drop writes the placement.

## 4. Link the cards

Hover the first card. A connector dot appears on its edge. Drag from that dot to the second card and
release. The link is stored as an edge with its own direction and description.

Select the link to change its path style or add a description.

## 5. Take a card off the board

Right-click `Interview notes` and choose **Remove from board**. The card leaves the board and stays in
the workspace, which puts it in the drawer's **Inbox** tab; the **Cards** tab still lists every card.

The row menu in the library offers **Place on board** to put it back.

## 6. Reload

Reload the page. The board and the card on it come back, and `Interview notes` is still in the Inbox.
The link is still in the document; it draws again as soon as both of its cards are on the board.

Move a card and reload again. The new position persists because the drop writes the placement to the
CRDT.

## 7. Look at the model

A workspace owns its cards. A board is a view that places those cards. A card exists without a board,
which is why the library can show it after it leaves one.

The model is described in [architecture.md](../reference/architecture.md). The layers that draw the
board and own each gesture are in [canvas.md](../reference/canvas.md); changing a gesture is
[change-the-canvas.md](../how-to/change-the-canvas.md).
