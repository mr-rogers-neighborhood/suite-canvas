# ADR-0072: An annotation is a card that points into a source

- **Status:** proposed — a spike record; nothing is built
- **Date:** 2026-10-25
- **Related:** [ADR-0012](./0012-field-granular-records.md) (field-granular records), [ADR-0011](./0011-library-dock-and-card-chrome.md), [ADR-0040](./0040-a-board-and-a-section-are-identities.md), [ADR-0044](./0044-one-target-primitive.md), [ADR-0051](./0051-one-style-vocabulary-over-edges.md), gate **A23**

## Context

The author's note: *"Should start to make a concrete decision about the easiest way to introduce
annotation cards and the capability to annotate pdfs, videos, and possibly images. Choosing high-level,
pre-existing libraries or frameworks might speed up the process if they are suitable and integrate well
with the existing system."*

The roadmap already says what an annotation *is* in two places, and they agree: **an annotation is a
card** (A13's amendment, "an attachment belongs to a card, and an annotation *is* one"), and **A23** wants
a PDF page or a video timecode to "carry annotations that project as cards, appear in the library, drop
onto the canvas, and detach into an ordinary card". A19 supplies the surrounding rule: no built-in media
card types, and metadata is fields.

So the question is not *what* an annotation is. It is **how a card records the range it points at**, and
**which readers/players we lean on** so the surface is a week of work rather than a quarter.

## Decision

**Three shapes over one record.** Every annotation is a card that carries a `target` plus a **range**:

| media | the range | the source |
| --- | --- | --- |
| PDF | page number + normalised rects (`x, y, w, h` in 0..1 of the page box) | attachment on a card, or a URL |
| video / audio | `from`/`to` seconds, plus an optional transcript span | attachment, or a URL |
| image | normalised rects, as PDF pages | attachment |

One field kind — `range` — with a discriminated payload, stored with the card like any other field value
(ADR-0012). A quote annotation stores text instead of geometry, which is the same record with an empty
range and a `quote` payload; that is what lets a card be "detached into an ordinary card" by doing
nothing at all to it.

### Libraries: three readers, not one abstraction

Recommendation, to be confirmed by a spike:

- **PDF — `pdf.js`** (Mozilla, Apache-2.0). The only real option in the browser: it renders to canvas and
  gives a **text layer with per-glyph boxes**, which is what turns a drag into stable rects. `react-pdf`
  is a thin React wrapper over the same engine; the choice there is "wrap it ourselves" versus "adopt the
  wrapper"
- **Video — the platform element plus a thin range UI.** Chromium and Safari both expose
  `currentTime`/`duration` and `timeupdate`, which is all a time range needs. There is no library worth
  adopting for *storing* a range; the value of a player library is the transport chrome, and ours is a
  card body, not a media page.
- **Image — no library.** A normalised rect over an `<img>` is twenty lines, and a library would bring its
  own annotation model that we would then have to translate into ours.

**Refused:** one "annotation framework" that owns its own storage (Hypothesis, RecogitoJS, Annotorious).
They solve a different problem — annotating *someone else's* page — and each brings a document model that
would become a second source of truth next to the card graph.

### The source is a reference, and it may vanish

An annotation stores `{ sourceKind, sourceId, range }`, never bytes. A deleted attachment therefore leaves
an annotation that still reads: its card keeps its text, its range renders as "the page is gone" rather
than as an error, and A23's "keeps working when the source is removed" is satisfied by construction. This
is the same rule as a portal with a deleted board: an identity that outlives its target.

## Consequences

**Easier**

- No new object type, no second store, no new export path: an annotation is a card, so it lands in the
  library, gets drag-and-drop, tags, types and backlinks for free.
- One `range` field kind covers three media, so the readers differ and the *record* does not.
- Detach is a no-op rather than a conversion — the card was always a card.

**Harder, and accepted**

- **Geometry needs a text layer.** A PDF annotation over a scanned page (no text layer) can only store a
  rect, so a quote cannot be extracted and the annotation is weaker. That is honest and visible.
- **A range is a claim about a mutable source.** If the underlying file is replaced, ranges drift. The
  mitigation is the one the reader surface can afford: store the source's byte size and a cheap hash, and
  mark annotations "source changed" rather than silently pointing at the wrong words.
- **The three readers are three surfaces.** They share the record, not the code. Pretending otherwise is
  where annotation features go to die.

## Open questions

1. **Is the range a field value or a record of its own?** A field keeps ADR-0012's model and gives
   filtering for free; a record would allow many annotations per card. The proposal is a field, because one
   annotation *is* one card.
2. **Where does the reader live?** A card focus surface (ADR-0049's full-canvas view) is the obvious host;
   a sideline panel is the alternative. Not decided here.
3. **Do highlights need their own paint?** A page's highlights are a projection of annotations onto the
   reader, so they may reuse the value palette instead of a new colour vocabulary — which is what
   ADR-0071 would require anyway.
4. **Video transcript alignment.** A time range is easy; mapping it onto a transcript span needs a
   timestamped transcript, which is a separate import problem. The range works without it.
