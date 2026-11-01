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
- **A property** you did not map, which is created on the type when you name it.

One highlight makes **one card**, always. The parts decide what that card says, not how many cards there are: a
paragraph worth three notes is three highlights, and a press that could make an unknown number of cards is a press you
cannot undo in one gesture.

## Kinds, and the slots they fill

A highlight's colour is its **kind**, and a kind knows what it produces: a Claim gets a Claim card, with a Question and
a Source. **Kinds** in the library's Annotations tab is where that is set: a colour, a name, the card type it makes,
and the list of slots it fills. Choosing a card type offers its own properties as slots, so the mapping starts from
what the type already knows.

A kind is what a highlight *is*; a type is what a card *is*. The library's own **Types** button manages card types, and
it is a different thing on purpose rather than a second name for the same one.

The raised passage then wears those slots as rows, empty until you fill them: select the words that answer a row and
they land in it. The passage keeps the type's colour and the filled ranges are **dotted**, so one highlight can show
its internal structure without turning into a patchwork. *Add a part* lets you map words the type did not expect.

## Four ways to carry a highlight

A highlight can be dragged onto the board from **the passage** you marked, from the book's **Highlights** panel, from
the library's **Annotations** tab, and from an **`@` mention** of it inside a card. All four do the same thing, because
they are one gesture with four starting points.

Typing `@` in a card body offers your highlights beside your cards: picking one inserts a chip that names the passage,
in its colour, and pressing that chip opens where the passage came from.

**Done** keeps the parts and leaves the highlight where it is. **Place** makes its one card and hands it to your
pointer: the surface steps aside, one press on the board puts the card down, and pressing Place again before you place
adds to the stack rather than starting a new one. A highlight whose card is already on a board opens that card instead
of making a second one.

## Placing several at once

Tick the checkboxes in the book's **Highlights** panel and press **Place N** to hand the whole selection to your
pointer, one card per press. The order you ticked them is the order they go down: the list in the corner of the board
shows the queue, and you can move a card up or down, take it out, or flip the whole queue with `[` and `]` without
leaving the board.

The triangle beside a row opens it to the whole passage, and to what each part of a broken-up highlight is for.

When the last card lands you are not thrown back into the book. A bar offers **Return to book** and **Place more
annotations**, and the board stays yours in the meantime, so a card that landed a little to the left can be moved. Escape
means **Return to book**.

The highlights you have made collect in the book's **Highlights** panel, beside its contents, with the ones that
became cards marked. They are also in the library's **Annotations** tab, grouped by book — pressing one opens the
passage, the arrow beside it places the card, and dragging one onto the board puts it down where you let go. A row
says where its card is: the card's title when it is on this board, `in the inbox` when it is not, and **Not a card
yet** before it is anything at all.

## What the card says

A card made from a highlight wears the passage above its body: the kind's colour down the left, the words, and the
book it came from. The writing underneath is yours, and it is where a comment on the passage belongs — there is no
separate comment system, because there is no separate kind of card.

The card arrives with two properties rather than a body: a read-only **Highlight** that names the passage, and a
**Source** that names the book. If the kind produces a card type with a template, the card gets that template's body,
title and properties — so a claim template can open with "State the claim" and the passage still sits above it. A kind
whose type has no template makes a card with no body at all, the same as any other new card of that type. That is what
makes the mapping worth writing: the parts fill properties, and the card type decides how those properties read.

One highlight makes one card. **Place** hands it to your pointer; pressing Place again opens the card the highlight
already made rather than making a second one, and a card you have put in the trash says so instead of being quietly
replaced.

The card is as tall as its passage, so a sentence is not buried under a fixed 240px box, and the passage is shown in
full rather than clipped to two lines. Once you resize one, the size you chose is kept.

**You can put the passage where you want it.** Add the **Highlight** property to a card's body and the passage moves down
there, drawn in full, and the strip above the body steps aside so it never appears twice. Put that block in a card
type's template and every card of that kind puts it wherever the template says, with the strip above the body as the
fallback for types that do not.

**Reopen** goes back to the passage, not merely to the book: the reader turns to its chapter, scrolls it into view and
raises it. **Keep it** cuts the link and writes the passage into the card's body as a quote with a link to the book, so
the card becomes an ordinary note you own, and the highlight can still produce another card later if you want one.

## How it reads

The page is yours to set: **text size**, **width** and a **page** that is the app's own, sepia or dim. They live in
the appearance panel with the canvas knobs, and they sink into the book and nowhere else — reading at midnight should
not turn your boards sepia. They are this device's preferences, like density and corner rounding, so a collaborator
never inherits them.

The book remembers where you were, down to how far down the chapter you had scrolled, and the contents list marks the
chapter you are in. The rule under the header is your place in the whole book, a chapter at a time.

The keyboard works the way a book does: **right** and **space** for the next chapter, **left** and **shift-space** for
the one before, **home** and **end** for the top and bottom of this chapter. Text you have selected keeps the space bar
for itself.

## Finding a passage by its words

The search button in the header reads the whole book once and searches all of it, so a passage you remember but
cannot place is a query rather than a guess at a chapter. **ctrl-f** or **cmd-f** opens the same field; each result
shows the words around the hit with the match lit inside them, grouped under the chapter it is in.

Pressing a result turns to that chapter and scrolls to the words themselves, which is the same landing a highlight
from the outline gives you. Two hits in one chapter land on their own occurrences rather than both on the first.

## Marks you can reach

A mark is a control: it takes focus with **tab**, opens with **enter** or **space**, and its menu opens with the
**menu key** or **shift-F10**. A passage that runs over a bold word or across a paragraph break is painted in pieces
that all belong to one highlight, and a highlight the chapter cannot find is counted under the header rather than
quietly left out.

The **Highlights** panel filters: everything, the ones that are not cards yet, or one kind at a time. The library's
**Annotations** tab carries the same filters plus a search over the words and the book's name, which is what you want
once a book has a hundred marks. Pressing a highlight there opens it where it lives: the reader turns to that chapter
and raises the passage.

The colours appear over the words you selected rather than at the bottom of the page.

## What it will not do

A book protected by DRM cannot be opened, and says so rather than failing halfway. A fixed-layout book — a comic,
a page-image textbook — draws the text it can find and not the pages it cannot.

The book's own stylesheet is dropped on purpose, because it would fight the app's type and could reach the network
for a font. Pictures come from the book's own files and never from anywhere else — the cover on the card and the
illustrations inside a chapter are both read out of the archive. A book that points at a picture on the web keeps the
words and loses the picture, and the chapter says so under the header.

A footnote is a link, and it works like one: pressing one turns to the page it names and scrolls to the place it
points at, and a link back to a mark on the same page goes there without turning.

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
