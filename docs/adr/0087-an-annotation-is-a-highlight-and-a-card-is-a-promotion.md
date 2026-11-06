# ADR-0087: an annotation is a highlight, and a card is a promotion

Status: accepted, 2026-10-31. Applies R4, R7, R10, R11, R12, R13 from the v2 rulebook.

## Context

The workflow the author wants is Heptabase's and Obsidian's: read a book on the canvas, mark a sentence, and
pull the mark out onto the board as a card that still knows where it came from. Three questions had to be
answered before any code: what an annotation *is*, what an annotation *type* is, and what an EPUB costs.

The rules that constrain the answers are already written down. `R7` says no new object class when a card type
suffices. `R13` says types add schema and never behaviour. `R4` says one anchor model for every annotatable
medium. `R10` says no open-ended value kinds. And `R11` says every reference-valued thing needs an honest
unshared state.

## Decision

**A highlight is a record, not a card.** `{ id, sourceCardId, styleId, anchor, excerpt?, cardId?, createdAt }` in
one additive document root. It exists before anybody decides what it becomes, and a book carries hundreds: as
cards from birth, they would fill the library, the inbox, search and every view with things nobody wrote. Its
first write is the only write a reader usually makes, which is what keeps a 300-highlight book a few hundred
small commits rather than a mapping war.

**The anchor is a union, written once.** `quote` (a spine index and the words), `page` (a page and rectangles),
`time` (a transcript and a span). All three parse from the first day; one has a renderer. Shipping the shape once
is cheaper than migrating every annotation when the PDF work lands, and a document carrying an anchor this build
cannot render says so instead of drawing an empty box.

**The anchor is a quote, not an offset.** Reflow invalidates offsets on every screen, and EPUB's CFI is
positional by construction — it breaks the moment we render the text ourselves, which sanitising a book
guarantees. Resolution is three passes: `prefix + quote + suffix`, then one side, then a bare quote only when it
occurs once. Ambiguity is reported and the mark is not drawn: a highlight in the wrong sentence is a lie the
reader cannot detect.

**A medium is a registered module.** `AnnotationMedium { anchorKind, describe, excerpt, openAt }` — the same shape
the embed and field-kind registries use. Nothing above the anchor knows which medium it serves, so the second and
third media are a module each. A test registers a fake PDF and a fake video, so a change that would force them to
alter the model shows up there first.

**A promotion makes an ordinary card.** It can be tagged, retyped, linked, searched and trashed like anything
else, because it is anything else. It arrives with three things it could not have invented: a default
**read-only** `annotation` property whose value is the closed shape `{ annotationId }`, a title taken from the
first sentence, and the record's `cardId` pointing back at it. The read-only rule lives in the kind, not in a
per-field switch: the anchor is the truth, and a card that could rewrite its own quote would disagree with the
mark it came from.

**An annotation style is data shared across media.** `{ id, name, color, templateTypeId? }`. A colour is a colour
whether it fills a line of a book, a rectangle on a page or a band on a timeline, and nothing branches on a style's
id (`R13`). `templateTypeId` is the RemNote-shaped hook: "green highlights become Claim cards" is a style pointing
at a template, which is data the graph already understands, rather than behaviour on a type.

**Comments need no feature.** A comment on a highlight is another block in the body of the card it became, which
is the strongest argument for annotations being ordinary cards.

**The library gets an `annotations` tab.** `LibraryTab` already documents the pattern — Sketches, Portals, Media
and Views are "the same cards, narrowed to one built-in type" — so the tab is a computed facet over cards, never a
second list. It reads the values rather than a type id, because a promoted highlight is an ordinary card whose
property points at a record.

## The EPUB half

**No EPUB dependency.** `epubjs`, Readium's `r2-*` and `foliate-js` all own a DOM, often inside an `iframe`. That
is what an anchor model cannot afford: we would reach into a second document for a `Selection`, style highlights
with the book's CSS instead of our tokens, and re-derive offsets per renderer. So the renderer is ours, and the
ZIP half was already in the repository: `launcher/vaultZip.ts` became `archive/zip.ts`, shared by the vault
importer and this reader.

**Chapters are sanitised, not trusted.** Script, event handlers, frames, objects and the book's own stylesheet are
dropped; remote images and fonts are refused rather than fetched (`R9`); internal links are rewritten into reader
navigation. `reader/ReaderChapter.tsx` is the one file allowed to inject HTML, named in `scripts/check-shape.mjs`
for that reason.

**Protection is detected, not assumed.** `META-INF/rights.xml`, or an `encryption.xml` entry covering a content
document, is a refusal with a sentence. Font obfuscation in `encryption.xml` is ordinary and must not trip it.

**The bytes are an attachment.** `application/epub+zip` joins the allowlist on both sides, and a book takes the
path every attachment takes: this browser's copy first, the relay second — which is why a book opens on a plane
and before it has finished uploading.

## Consequences

- The projection's container copier dropped plain JSON values silently, so a share lost every payload stored as an
  object. Annotations surfaced it; the copier now carries them.
- A share copies the highlights of the sources it includes and reports the rest as withheld, the same rule a
  private card reference follows.
- Reading position is reader state: per workspace, per attachment, in `localStorage`, never written.
- `WorkspaceDocument` went past its file-length limit with the surface in it, so the facade is
  `facade/annotations.ts` and `CardsFacade` extends it.

## Open

- **Drag-out.** The gesture is planned (the reader steps aside while a highlight is carried, as the library drawer
  does) and not built: promotion is a press today.
- **A body that opens with the passage.** The card's title carries the first sentence and the field carries the
  quote; writing a body paragraph needs a body-write API the facade does not have yet.
- **More media**, each one a module: PDF (`page`), audio and video (`time`).
- **A general read-only field flag**, which would make the `annotation` kind's rule one instance of a rule.

## Amendment — 2026-11-01: promotion writes properties, and the type writes the body

The decision above says a promotion "arrives with three things it could not have invented: a default read-only
`annotation` property, a title taken from the first sentence, and the record's `cardId`". The body write that went with
them was a mistake, and it was visible the moment a kind pointed at a type with a template.

`createCard` already copies a type's template card: its body, its title, its properties, its tags, its connectors. A
promotion that then wrote a blockquote and a "From …" paragraph **discarded the template the reader had authored for
that kind of card**. So a reader could map a highlight onto a type, give the type a template, and watch the template
disappear on the first promotion.

**Promotion writes properties and nothing else.** What arrives is the read-only `Highlight` property, a `Source` `card`
property naming the book, and the parts the reader mapped onto fields. A type with a template keeps its body and its
title; a type without one produces a card with no body, which is what an ordinary new card of that type looks like. The
backlink survives because `propertySources` reads a card-valued property as a link, so the book's Links list shows the
card and the card's shows the book.

The title rule is now a precedence rather than an invention: a part mapped to `title`, else the template's own title,
else the passage's first sentence.

**De-linking materialises what promotion stopped writing.** The "Open" item above asked for a body-write API; **Keep it**
is the one place that needs one, so it is the one place that uses it. It appends the quote as a blockquote and a
paragraph mentioning the book, clears the `annotation` property as the app, and clears the record's `cardId`, all in one
batch.

Two supporting changes fell out of doing this. `addField` now drops the cached type, because a batch defers the commit
whose document event invalidates that cache, and a field added and immediately written to inside one batch was
invisible. And `AnnotationCardFace` no longer claims the passage is "already in the body as a quote", because it is not.
