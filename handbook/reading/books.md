---
title: Reading a book on a card
description: "An EPUB on the canvas: the contents, the chapter, and the highlights you can pull out of it."
order: 110
targets:
  - kind: ui
    id: book-reader
---

Drop an `.epub` onto a board and it becomes a card. Open it and the reader draws the book a chapter at a time, in
the app's own type rather than the book's: the contents in the header, the chapter in a column wide enough to
read, and the buttons that turn a page.

The reader is a *reader*. It shows what the book says and nothing else: no page numbers to argue with, and no
second scrollbar inside the canvas.

## Highlights

Select a sentence and four colours appear over it. Press one and the sentence is marked. The mark is stored as the
words themselves rather than as a position, which is why it stays on its passage when you resize the window,
change the theme, or open the same book at a different width.

**Press a highlight to make a card out of it.** The card is an ordinary card in every way — it can be tagged,
retyped, linked and searched — and it arrives knowing where it came from: a read-only **Highlight** property points
at the passage, so the card is never a second copy of the quote that could go out of date. The library's
**Annotations** tab is every card that came from a mark.

A comment on a highlight is the next block in the body of that card. There is no separate comment system, because
there is no separate kind of card.

## What it will not do

A book protected by DRM cannot be opened, and says so rather than failing halfway. A fixed-layout book — a comic,
a page-image textbook — draws the text it can find and not the pages it cannot.

The book's own stylesheet is dropped on purpose, because it would fight the app's type and could reach the network
for a font. Pictures inside the book are drawn from the book's own files and never fetched from anywhere else.

## Getting a book onto the board

**Right-click the canvas → New media → Book**, or press `/media` in a card body and pick Book. Either way the same
picker asks which kind, and the same upload puts the block where you asked: at the caret of the card you are
writing, or in a new card at the point you right-clicked. The card is made after you choose the file, so cancelling
the dialog leaves nothing behind.

On the card you get the cover: the title and author the book declares, its picture if it has one, and **Read**. The
reading itself happens large, with the app's chrome still live around it — so a highlight can be carried out of the
book and onto the board.

Carrying a highlight takes a small drag. The book steps out of the way while the highlight is in your hand, and if
you let go anywhere but the board, nothing is made.
