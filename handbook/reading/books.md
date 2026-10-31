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

## Breaking a highlight apart

Press a highlight and it is raised: the chapter blurs, the passage sits alone, and the words are yours to cut up. This
is the answer to a sentence whose real concept is at the end — a title taken from the first few words is a title taken
from the setup clause.

Select a range inside the raised passage and say where it goes:

- **Title** — these words name the card.
- **A property** — these words fill a property, made for you if the type does not have it yet.
- **Own card** — these words become a card of their own, which is how one paragraph turns into several notes.

## Types, and the slots they fill

A highlight's colour is its **type**, and a type knows what it produces: a Claim gets a Claim card, with a Question and
a Source. **Types** in the library's Annotations tab is where that is set: a colour, a name, the card type it makes,
and the list of slots it fills. Choosing a card type offers its own properties as slots, so the mapping starts from
what the type already knows.

The raised passage then wears those slots as rows, empty until you fill them: select the words that answer a row and
they land in it. The passage keeps the type's colour and the filled ranges are **dotted**, so one highlight can show
its internal structure without turning into a patchwork. *Add a part* lets you map words the type did not expect.

## Four ways to carry a highlight

A highlight can be dragged onto the board from **the passage** you marked, from the book's **Highlights** panel, from
the library's **Annotations** tab, and from an **`@` mention** of it inside a card. All four do the same thing, because
they are one gesture with four starting points.

Typing `@` in a card body offers your highlights beside your cards: picking one inserts a chip that names the passage,
in its colour, and pressing that chip opens where the passage came from.

**Done** keeps the parts and leaves the highlight where it is. **Place** makes the cards, and says how many it will
make before you press it. A highlight that has already been placed opens its card rather than making a second one.

The highlights you have made collect in the book's **Highlights** panel, beside its contents, with the ones that
became cards marked. They are also in the library's **Annotations** tab, grouped by book — pressing one opens the
passage, and dragging one onto the board places it there.

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

On the card you get the book itself: the cover fills it the way a picture fills an image card, with the title, the author and the chapter count beneath, and **Read** under those. A book whose bytes have not arrived yet shows an empty tile rather than a broken picture. The
reading itself happens large, with the app's chrome still live around it — so a highlight can be carried out of the
book and onto the board.

Carrying a highlight takes a small drag. The book steps out of the way while the highlight is in your hand, and if
you let go anywhere but the board, nothing is made.
