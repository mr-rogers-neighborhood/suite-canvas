# ADR-0094: a video mark is a span of time

- Status: proposed
- Date: 2026-11-02
- Shipped: the time medium, the player, the two-press span, the timeline, the marks panel, inline and pinned playback.
- Remaining: transcripts, parts on a time anchor, uploaded video.
- Builds on: ADR-0087 (a highlight is a promotion), ADR-0088 (a cover block, reading in focus), ADR-0093 (a mark is a
  place you can reach).

## Context

The anchor union already had a `time` variant and no medium using it. The registry built for exactly this had no
registrations at all, so every surface opened a source by calling the store by hand. Video is the second medium and
the first proof that the seam works; PDF follows the same path.

Four questions had to be answered before writing code, and the answers are constrained by what already exists: an
annotation is a record with an anchor, a palette shared across media, notes, tags and a one-card promotion, and the
app is local-first with a content policy of `script-src 'self'`.

## Decision

**The medium is YouTube, link-first, with no captions.** A mark is `{ kind: "time", locator: "youtube:<id>",
startMs, endMs }`. No uploads, so no Range requests and no new storage; the roadmap's own cut is "uploaded video,
early", and its condition is demonstrated demand for link-first video.

**The record carries no text, and a video that changes is not repaired.** A quote survives reflow because it carries
its words; a span is absolute seconds and carries nothing. A replaced video therefore points at the same seconds of a
different video, silently. That is the accepted cost of link-first video, not an oversight: the repair a quote gets is
text, and text is what a transcript will bring. Until then the honest thing is to say so, which the handbook does.

**`locator` is namespaced.** `youtube:<videoId>` rather than a bare id, because a card can hold more than one video
and the prefix is the seam an uploaded file needs (`attachment:<id>`). The id is validated before it reaches an
iframe address, so a hand-edited record cannot point the player at another origin.

**A mark is made with two presses of one colour.** Colour first, span opens at the playhead, the same colour closes it.
Colour first because the reader is watching rather than operating a range control, and because it is the same gesture a
book's palette already uses. **A different colour restyles an open span rather than committing it** — a reader changing
their mind about what a mark is has not finished making it. A floor of one second keeps a paused frame from producing
a zero-length mark the schema would refuse.

**An open span belongs to a host, not to the document.** There is no second record for "a mark being made", so an
abandoned press cannot outlive its surface or reach a collaborator.

**The surface is the card and the focus surface, and a pin is the third.** The card's block plays and marks; the focus
surface adds the timeline and the panel; a pinned card is the same player at the size the reader chose. One player
component, one position store, and the inline block draws a poster while its card is open large, because two embeds of
one video play out of step and the one behind the surface is the one nobody can see.

**Opened from a card, a mark seeks and does not raise.** A book has to turn a page and scroll a column, so raising the
passage is how the reader learns where they landed; a video seeks to the exact second, and a modal would be the app
getting in the way of the thing that was asked for.

**Control is `postMessage`, not the IFrame Player API.** `script-src 'self'` is a policy worth keeping, so the player's
message protocol lives in one file with no DOM and no JSX. It is unofficial; the fallback is the embed address's own
`start` parameter, which needs none of it. A player that never answers still plays, and the reader loses only the
app-driven seek.

**Playback position is reader state.** It is not in the document and not persisted, the same rule a reading position
follows: two people watching one card are not at the same second. It exists so a node view re-created by a peer's edit
resumes instead of restarting (ADR-0088's finding).

**The registry's `openAt` takes the record, not the anchor.** An anchor names a place inside a source; only the record
names the source. Nothing was registered, so the change cost nothing, and a medium that received an anchor alone could
not open anything.

## Consequences

- `parts` remain quote-only. A part indexes characters, and a span of time has no characters until a transcript exists;
  allowing sub-spans would invent a second meaning for `start`/`end`.
- The schema gains one guard: `endMs >= startMs`. No `time` record predates it.
- `BookHighlights` became a wrapper over `SourceHighlights`, so the book's panel and a video's cannot drift again.
- `wordsOf`, `passageTextOf`, the mention chip and the library headings go through the medium instead of a `kind`
  switch, which is what makes a medium this build lacks read as its stored excerpt rather than as "A passage".
- De-linking a promoted video card writes the span into the card body, so **Keep it** keeps the only thing the mark was
  about.

## Open

- **Transcripts.** The next decision is where caption text lives. The answer recorded when this was planned is the
  workspace document, shared and searchable, with a redaction rule for shares. Where the bytes come from is still open:
  a reader-supplied `.vtt`/`.srt` is reliable and has no dependency; a relay proxy for YouTube's own tracks is
  convenient and unofficial. The official Data API cannot serve captions for a video you do not own.
- **Parts on a time anchor.** Once a transcript exists, a part can index its cue text, and the raise surface can fill a
  template's slots the way a book does.
- **Uploaded video.** The gate is concrete: the relay serves attachments as one buffered `200` with a 100 MiB cap, so
  a readable scrub needs `206 Partial Content` first.
- **PDF.** The `page` anchor has rects already. It should be a medium module and a registration, and nothing above the
  anchor should change.
