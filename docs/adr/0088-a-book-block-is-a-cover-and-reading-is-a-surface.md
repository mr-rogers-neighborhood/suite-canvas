# ADR-0088: a book block is a cover, and reading is a surface

Status: accepted, 2026-10-31. Amends ADR-0087; adds the media picker's second target.

## Context

An EPUB arrived as a `media` block with `kind: "epub"`, which is the right shape: it travels in a card body, copies
as metadata only, and looks like every other media kind. The obvious next step was to draw the reader inside that
block. Three findings say no, and the first is decisive.

**ProseMirror owns the selection inside a `contentEditable` region.** The reader's flagship gesture is selecting a
sentence. Inside a node view, that selection belongs to the editor: it reconciles a DOM selection its document has
no positions for and can clamp it back. A gesture that fights its host is a bug that reads as "sometimes it just
doesn't work", which is the worst kind to diagnose.

**A node view is re-created whenever its node is replaced** — `setBodyNodes`, a template install, a peer's structural
change, the body-text migration. A live reader there would re-parse the archive and restart on chapter one because a
collaborator renamed a card.

**A chapter needs its own viewport.** The card body is sized by its content and scrolls with the card; nesting a
reading column's scroll inside it is the two-scroll-models problem that made the old library feel wrong.

## Decision

**The block draws a cover; reading happens in focus mode.** `BookView` reads the *package* — title, author, declared
cover — and offers **Read**. `CardFocusHost` branches to the reader for a card that holds a book, exactly as it
already branches to `WhiteboardFocus` for a whiteboard. Selection then happens in a plain div, the reading session
survives every transaction, and the chapter gets the measure it needs.

The node is untouched: still `media`, still `kind: "epub"`, still metadata-only. What changed is where the expensive
part is drawn.

**The media picker serves two targets.** `useMediaPicker` holds a *target* — an editor to insert at, or a board point
to make a card at — instead of an editor. A kind is defined once and works in both, so the `/` menu and the board's
right-click cannot drift. `New media…` uses the board target and creates the card **after** a file is chosen: a
cancelled dialog leaves no orphan, which is the opposite of `New view` and right for the opposite reason — there, the
card is what the reader asked for; here, the file is.

**A promoted card opens with its passage.** `setBodyNodes` writes a blockquote, then a paragraph naming the source
with a mention, so the backlink is the graph's own reference and not a second kind of link. This closes the gap
ADR-0087 recorded as needing an API.

**`readOnly` is a general field flag.** A reader can pin a field; the writer refuses with a named reason, and the one
way around it is `{ asApp: true }`, which is how a promotion or an import fills it. The `annotation` kind keeps its
own app-written lock: the flag is a decision about a field, while the kind's lock is a fact about where the truth
lives. The flag travels in a projection and does not hide a value — a share already redacts what it does not include,
and a field that vanished from a shared card would read as data loss.

## Consequences

- `insertMediaFiles` split into `prepareMediaFile` and an insert, because the upload is the same work in both targets
  and the permission check, the local copy and the relay attempt must not be duplicated.
- `WorkspaceDocument` gained `bodyNodes`, the reader's pair to `setBodyNodes`, so a surface can draw a block out of a
  body without mounting an editor.
- The focus surface conceals itself while a highlight is carried, the way the library drawer does, so the board is
  visible to drop on.
- A promotion only happens on a release over the canvas. A press that never travelled stays a press, which is why a
  drag the reader changed their mind about leaves nothing behind.

## Open

- PDF and video, each one medium module.
- A cover block could show the first page behind Read; not yet.
- Reading position is per browser; cross-device is a later decision.
