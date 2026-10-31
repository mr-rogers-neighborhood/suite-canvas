## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A highlight can be broken into parts. Press one and it is raised: the chapter blurs, the passage sits alone, and a
  range you select can be marked as the card's **title**, as a **property** (created on the promoted type when it is
  missing), or as a **card of its own**. That last one is how a paragraph becomes several notes.
- A right-click on a highlight opens its menu: type, break it apart, place it or open the card it became, copy, remove.
  The raised surface carries the same rows, so there is one action list rather than two.
- A book's **Highlights** panel, beside its contents: the marks you have made, with the ones that became cards marked.
- The library's Annotations tab lists **highlights** rather than only their cards, grouped by book, with a drag
  promoting one onto the board and a press opening the passage.

### Changed

- Placing a highlight that already became a card opens that card instead of making a second one, which used to
  overwrite the record's card and orphan the first. Making another is now an explicit choice.

### Fixed

- A book's cover no longer falls back to an empty tile until a refresh. The cover cache had two states, so "not read
  yet" and "read, no cover" were the same answer, and a first paint that raced an upload gave up for the session.
  It is three states now, and a pending book retries.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A book card on the canvas draws the book: the cover fills the card the way a picture fills an image card, with the
  title, author and chapter count beneath and **Read** under those. The cover is extracted once per session and
  published, so a board of forty cards does not open forty archives before its first paint; a book whose bytes have
  not arrived shows an empty tile rather than a broken picture.

### Fixed

- Dragging a highlight out of a book reaches the board. The carry is released with the gesture whether or not the
  drop lands on the canvas, so a reader cannot end up holding something with no way to put it down, and the concealing
  focus surface lets the pointer through to the board underneath.
- The press that starts a highlight drag no longer selects the shell: the default press began the browser's own text
  selection and the drag then dragged it across the window.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A highlight can be broken into parts. Press one and it is raised: the chapter blurs, the passage sits alone, and a
  range you select can be marked as the card's **title**, as a **property** (created on the promoted type when it is
  missing), or as a **card of its own**. That last one is how a paragraph becomes several notes.
- A right-click on a highlight opens its menu: type, break it apart, place it or open the card it became, copy, remove.
  The raised surface carries the same rows, so there is one action list rather than two.
- A book's **Highlights** panel, beside its contents: the marks you have made, with the ones that became cards marked.
- The library's Annotations tab lists **highlights** rather than only their cards, grouped by book, with a drag
  promoting one onto the board and a press opening the passage.

### Changed

- Placing a highlight that already became a card opens that card instead of making a second one, which used to
  overwrite the record's card and orphan the first. Making another is now an explicit choice.

### Fixed

- A book's cover no longer falls back to an empty tile until a refresh. The cover cache had two states, so "not read
  yet" and "read, no cover" were the same answer, and a first paint that raced an upload gave up for the session.
  It is three states now, and a pending book retries.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A book can be uploaded: **New media → Book** on the canvas, or `/media` in a card body. The picker is now the one
  place a media kind is chosen and it serves two targets, so at a caret it inserts and on the canvas it makes a card
  at the point you pressed. The card is made after the file is chosen, so a cancelled dialog leaves nothing behind.
- A book block draws a cover: the title, author and cover picture the package declares, and **Read**. Reading
  happens large, in focus mode, where selecting a sentence is a selection rather than a fight with the editor.
- A highlight can be carried out of the book onto the board: a press that travels picks it up, the book steps aside,
  and a release over the canvas makes the card there. A release anywhere else creates nothing.
- A promoted card now opens with its passage: the quote as a blockquote, then a paragraph naming the source with a
  mention, so the backlink is the graph's own reference.
- A field can be marked read-only. `setProperty` refuses a change from a reader with a named reason, and the one way
  around it is the flag the code that fills the field passes. The flag travels in a share and does not hide a value.

### Changed

- `insertMediaFiles` split into `prepareMediaFile` and an insert, because two targets now need the same upload: the
  permission check, the local copy and the relay attempt live in one place.
- `WorkspaceDocument` gained `bodyNodes`, the reader's pair to `setBodyNodes`, so a surface can draw a block out of a
  body without mounting an editor.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A highlight can be broken into parts. Press one and it is raised: the chapter blurs, the passage sits alone, and a
  range you select can be marked as the card's **title**, as a **property** (created on the promoted type when it is
  missing), or as a **card of its own**. That last one is how a paragraph becomes several notes.
- A right-click on a highlight opens its menu: type, break it apart, place it or open the card it became, copy, remove.
  The raised surface carries the same rows, so there is one action list rather than two.
- A book's **Highlights** panel, beside its contents: the marks you have made, with the ones that became cards marked.
- The library's Annotations tab lists **highlights** rather than only their cards, grouped by book, with a drag
  promoting one onto the board and a press opening the passage.

### Changed

- Placing a highlight that already became a card opens that card instead of making a second one, which used to
  overwrite the record's card and orphan the first. Making another is now an explicit choice.

### Fixed

- A book's cover no longer falls back to an empty tile until a refresh. The cover cache had two states, so "not read
  yet" and "read, no cover" were the same answer, and a first paint that raced an upload gave up for the session.
  It is three states now, and a pending book retries.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A book card on the canvas draws the book: the cover fills the card the way a picture fills an image card, with the
  title, author and chapter count beneath and **Read** under those. The cover is extracted once per session and
  published, so a board of forty cards does not open forty archives before its first paint; a book whose bytes have
  not arrived shows an empty tile rather than a broken picture.

### Fixed

- Dragging a highlight out of a book reaches the board. The carry is released with the gesture whether or not the
  drop lands on the canvas, so a reader cannot end up holding something with no way to put it down, and the concealing
  focus surface lets the pointer through to the board underneath.
- The press that starts a highlight drag no longer selects the shell: the default press began the browser's own text
  selection and the drag then dragged it across the window.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A highlight can be broken into parts. Press one and it is raised: the chapter blurs, the passage sits alone, and a
  range you select can be marked as the card's **title**, as a **property** (created on the promoted type when it is
  missing), or as a **card of its own**. That last one is how a paragraph becomes several notes.
- A right-click on a highlight opens its menu: type, break it apart, place it or open the card it became, copy, remove.
  The raised surface carries the same rows, so there is one action list rather than two.
- A book's **Highlights** panel, beside its contents: the marks you have made, with the ones that became cards marked.
- The library's Annotations tab lists **highlights** rather than only their cards, grouped by book, with a drag
  promoting one onto the board and a press opening the passage.

### Changed

- Placing a highlight that already became a card opens that card instead of making a second one, which used to
  overwrite the record's card and orphan the first. Making another is now an explicit choice.

### Fixed

- A book's cover no longer falls back to an empty tile until a refresh. The cover cache had two states, so "not read
  yet" and "read, no cover" were the same answer, and a first paint that raced an upload gave up for the session.
  It is three states now, and a pending book retries.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- Reading a book on the canvas: an `.epub` dropped onto a board becomes a card, and the reader draws it a
  chapter at a time in the app's own type, with the book's contents in the header. No EPUB dependency: the ZIP
  reader the vault importer already had now lives in `archive/zip.ts` and both use it, and the container,
  package, spine and contents are read on top of it.
- Highlights: select a sentence, press a colour, and the passage is marked. The mark is stored as the words
  themselves, so it survives a resize, a theme change and the same book at another width. Four styles to start,
  shared across every medium, and a style may name a template.
- Pressing a highlight makes an ordinary card that knows where it came from: a read-only `Highlight` property
  points at the passage, the title comes from the first sentence, and the library's new **Annotations** tab is
  every card that came from a mark. A comment on a highlight is the next block in that card's body, because the
  card is a normal card.
- `application/epub+zip` joins the attachment allowlist on both sides, with the extension its download name uses.
- A media block this build has no renderer for now says so instead of drawing a broken image.

### Changed

- The annotation model is written medium-neutral from the first day: the anchor is a `quote`, `page` or `time`
  union and a medium registers itself, so a PDF page and a span of video are a module each rather than a schema
  change. Fake PDF and video media in a test guard that.
- The projection's container copier carries plain JSON values. It dropped them silently, so a share lost every
  payload stored as an object.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A highlight can be broken into parts. Press one and it is raised: the chapter blurs, the passage sits alone, and a
  range you select can be marked as the card's **title**, as a **property** (created on the promoted type when it is
  missing), or as a **card of its own**. That last one is how a paragraph becomes several notes.
- A right-click on a highlight opens its menu: type, break it apart, place it or open the card it became, copy, remove.
  The raised surface carries the same rows, so there is one action list rather than two.
- A book's **Highlights** panel, beside its contents: the marks you have made, with the ones that became cards marked.
- The library's Annotations tab lists **highlights** rather than only their cards, grouped by book, with a drag
  promoting one onto the board and a press opening the passage.

### Changed

- Placing a highlight that already became a card opens that card instead of making a second one, which used to
  overwrite the record's card and orphan the first. Making another is now an explicit choice.

### Fixed

- A book's cover no longer falls back to an empty tile until a refresh. The cover cache had two states, so "not read
  yet" and "read, no cover" were the same answer, and a first paint that raced an upload gave up for the session.
  It is three states now, and a pending book retries.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A book card on the canvas draws the book: the cover fills the card the way a picture fills an image card, with the
  title, author and chapter count beneath and **Read** under those. The cover is extracted once per session and
  published, so a board of forty cards does not open forty archives before its first paint; a book whose bytes have
  not arrived shows an empty tile rather than a broken picture.

### Fixed

- Dragging a highlight out of a book reaches the board. The carry is released with the gesture whether or not the
  drop lands on the canvas, so a reader cannot end up holding something with no way to put it down, and the concealing
  focus surface lets the pointer through to the board underneath.
- The press that starts a highlight drag no longer selects the shell: the default press began the browser's own text
  selection and the drag then dragged it across the window.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A highlight can be broken into parts. Press one and it is raised: the chapter blurs, the passage sits alone, and a
  range you select can be marked as the card's **title**, as a **property** (created on the promoted type when it is
  missing), or as a **card of its own**. That last one is how a paragraph becomes several notes.
- A right-click on a highlight opens its menu: type, break it apart, place it or open the card it became, copy, remove.
  The raised surface carries the same rows, so there is one action list rather than two.
- A book's **Highlights** panel, beside its contents: the marks you have made, with the ones that became cards marked.
- The library's Annotations tab lists **highlights** rather than only their cards, grouped by book, with a drag
  promoting one onto the board and a press opening the passage.

### Changed

- Placing a highlight that already became a card opens that card instead of making a second one, which used to
  overwrite the record's card and orphan the first. Making another is now an explicit choice.

### Fixed

- A book's cover no longer falls back to an empty tile until a refresh. The cover cache had two states, so "not read
  yet" and "read, no cover" were the same answer, and a first paint that raced an upload gave up for the session.
  It is three states now, and a pending book retries.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A book can be uploaded: **New media → Book** on the canvas, or `/media` in a card body. The picker is now the one
  place a media kind is chosen and it serves two targets, so at a caret it inserts and on the canvas it makes a card
  at the point you pressed. The card is made after the file is chosen, so a cancelled dialog leaves nothing behind.
- A book block draws a cover: the title, author and cover picture the package declares, and **Read**. Reading
  happens large, in focus mode, where selecting a sentence is a selection rather than a fight with the editor.
- A highlight can be carried out of the book onto the board: a press that travels picks it up, the book steps aside,
  and a release over the canvas makes the card there. A release anywhere else creates nothing.
- A promoted card now opens with its passage: the quote as a blockquote, then a paragraph naming the source with a
  mention, so the backlink is the graph's own reference.
- A field can be marked read-only. `setProperty` refuses a change from a reader with a named reason, and the one way
  around it is the flag the code that fills the field passes. The flag travels in a share and does not hide a value.

### Changed

- `insertMediaFiles` split into `prepareMediaFile` and an insert, because two targets now need the same upload: the
  permission check, the local copy and the relay attempt live in one place.
- `WorkspaceDocument` gained `bodyNodes`, the reader's pair to `setBodyNodes`, so a surface can draw a block out of a
  body without mounting an editor.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A highlight can be broken into parts. Press one and it is raised: the chapter blurs, the passage sits alone, and a
  range you select can be marked as the card's **title**, as a **property** (created on the promoted type when it is
  missing), or as a **card of its own**. That last one is how a paragraph becomes several notes.
- A right-click on a highlight opens its menu: type, break it apart, place it or open the card it became, copy, remove.
  The raised surface carries the same rows, so there is one action list rather than two.
- A book's **Highlights** panel, beside its contents: the marks you have made, with the ones that became cards marked.
- The library's Annotations tab lists **highlights** rather than only their cards, grouped by book, with a drag
  promoting one onto the board and a press opening the passage.

### Changed

- Placing a highlight that already became a card opens that card instead of making a second one, which used to
  overwrite the record's card and orphan the first. Making another is now an explicit choice.

### Fixed

- A book's cover no longer falls back to an empty tile until a refresh. The cover cache had two states, so "not read
  yet" and "read, no cover" were the same answer, and a first paint that raced an upload gave up for the session.
  It is three states now, and a pending book retries.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A book card on the canvas draws the book: the cover fills the card the way a picture fills an image card, with the
  title, author and chapter count beneath and **Read** under those. The cover is extracted once per session and
  published, so a board of forty cards does not open forty archives before its first paint; a book whose bytes have
  not arrived shows an empty tile rather than a broken picture.

### Fixed

- Dragging a highlight out of a book reaches the board. The carry is released with the gesture whether or not the
  drop lands on the canvas, so a reader cannot end up holding something with no way to put it down, and the concealing
  focus surface lets the pointer through to the board underneath.
- The press that starts a highlight drag no longer selects the shell: the default press began the browser's own text
  selection and the drag then dragged it across the window.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A highlight can be broken into parts. Press one and it is raised: the chapter blurs, the passage sits alone, and a
  range you select can be marked as the card's **title**, as a **property** (created on the promoted type when it is
  missing), or as a **card of its own**. That last one is how a paragraph becomes several notes.
- A right-click on a highlight opens its menu: type, break it apart, place it or open the card it became, copy, remove.
  The raised surface carries the same rows, so there is one action list rather than two.
- A book's **Highlights** panel, beside its contents: the marks you have made, with the ones that became cards marked.
- The library's Annotations tab lists **highlights** rather than only their cards, grouped by book, with a drag
  promoting one onto the board and a press opening the passage.

### Changed

- Placing a highlight that already became a card opens that card instead of making a second one, which used to
  overwrite the record's card and orphan the first. Making another is now an explicit choice.

### Fixed

- A book's cover no longer falls back to an empty tile until a refresh. The cover cache had two states, so "not read
  yet" and "read, no cover" were the same answer, and a first paint that raced an upload gave up for the session.
  It is three states now, and a pending book retries.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Changed

- Views and the handbook are shut in every build, not only in production. `views/availability.ts` and
  `handbook/availability.ts` are constants now, and the projection float, the two canvas rows that made a
  view and the library's Views tab gained the guard they were missing. Nothing is deleted: saved views and
  view cards in an existing document still open, the handbook's articles still ship to the docs site, and
  `explain` answers in the floating panel again.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A highlight can be broken into parts. Press one and it is raised: the chapter blurs, the passage sits alone, and a
  range you select can be marked as the card's **title**, as a **property** (created on the promoted type when it is
  missing), or as a **card of its own**. That last one is how a paragraph becomes several notes.
- A right-click on a highlight opens its menu: type, break it apart, place it or open the card it became, copy, remove.
  The raised surface carries the same rows, so there is one action list rather than two.
- A book's **Highlights** panel, beside its contents: the marks you have made, with the ones that became cards marked.
- The library's Annotations tab lists **highlights** rather than only their cards, grouped by book, with a drag
  promoting one onto the board and a press opening the passage.

### Changed

- Placing a highlight that already became a card opens that card instead of making a second one, which used to
  overwrite the record's card and orphan the first. Making another is now an explicit choice.

### Fixed

- A book's cover no longer falls back to an empty tile until a refresh. The cover cache had two states, so "not read
  yet" and "read, no cover" were the same answer, and a first paint that raced an upload gave up for the session.
  It is three states now, and a pending book retries.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A book card on the canvas draws the book: the cover fills the card the way a picture fills an image card, with the
  title, author and chapter count beneath and **Read** under those. The cover is extracted once per session and
  published, so a board of forty cards does not open forty archives before its first paint; a book whose bytes have
  not arrived shows an empty tile rather than a broken picture.

### Fixed

- Dragging a highlight out of a book reaches the board. The carry is released with the gesture whether or not the
  drop lands on the canvas, so a reader cannot end up holding something with no way to put it down, and the concealing
  focus surface lets the pointer through to the board underneath.
- The press that starts a highlight drag no longer selects the shell: the default press began the browser's own text
  selection and the drag then dragged it across the window.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A highlight can be broken into parts. Press one and it is raised: the chapter blurs, the passage sits alone, and a
  range you select can be marked as the card's **title**, as a **property** (created on the promoted type when it is
  missing), or as a **card of its own**. That last one is how a paragraph becomes several notes.
- A right-click on a highlight opens its menu: type, break it apart, place it or open the card it became, copy, remove.
  The raised surface carries the same rows, so there is one action list rather than two.
- A book's **Highlights** panel, beside its contents: the marks you have made, with the ones that became cards marked.
- The library's Annotations tab lists **highlights** rather than only their cards, grouped by book, with a drag
  promoting one onto the board and a press opening the passage.

### Changed

- Placing a highlight that already became a card opens that card instead of making a second one, which used to
  overwrite the record's card and orphan the first. Making another is now an explicit choice.

### Fixed

- A book's cover no longer falls back to an empty tile until a refresh. The cover cache had two states, so "not read
  yet" and "read, no cover" were the same answer, and a first paint that raced an upload gave up for the session.
  It is three states now, and a pending book retries.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A book can be uploaded: **New media → Book** on the canvas, or `/media` in a card body. The picker is now the one
  place a media kind is chosen and it serves two targets, so at a caret it inserts and on the canvas it makes a card
  at the point you pressed. The card is made after the file is chosen, so a cancelled dialog leaves nothing behind.
- A book block draws a cover: the title, author and cover picture the package declares, and **Read**. Reading
  happens large, in focus mode, where selecting a sentence is a selection rather than a fight with the editor.
- A highlight can be carried out of the book onto the board: a press that travels picks it up, the book steps aside,
  and a release over the canvas makes the card there. A release anywhere else creates nothing.
- A promoted card now opens with its passage: the quote as a blockquote, then a paragraph naming the source with a
  mention, so the backlink is the graph's own reference.
- A field can be marked read-only. `setProperty` refuses a change from a reader with a named reason, and the one way
  around it is the flag the code that fills the field passes. The flag travels in a share and does not hide a value.

### Changed

- `insertMediaFiles` split into `prepareMediaFile` and an insert, because two targets now need the same upload: the
  permission check, the local copy and the relay attempt live in one place.
- `WorkspaceDocument` gained `bodyNodes`, the reader's pair to `setBodyNodes`, so a surface can draw a block out of a
  body without mounting an editor.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A highlight can be broken into parts. Press one and it is raised: the chapter blurs, the passage sits alone, and a
  range you select can be marked as the card's **title**, as a **property** (created on the promoted type when it is
  missing), or as a **card of its own**. That last one is how a paragraph becomes several notes.
- A right-click on a highlight opens its menu: type, break it apart, place it or open the card it became, copy, remove.
  The raised surface carries the same rows, so there is one action list rather than two.
- A book's **Highlights** panel, beside its contents: the marks you have made, with the ones that became cards marked.
- The library's Annotations tab lists **highlights** rather than only their cards, grouped by book, with a drag
  promoting one onto the board and a press opening the passage.

### Changed

- Placing a highlight that already became a card opens that card instead of making a second one, which used to
  overwrite the record's card and orphan the first. Making another is now an explicit choice.

### Fixed

- A book's cover no longer falls back to an empty tile until a refresh. The cover cache had two states, so "not read
  yet" and "read, no cover" were the same answer, and a first paint that raced an upload gave up for the session.
  It is three states now, and a pending book retries.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A book card on the canvas draws the book: the cover fills the card the way a picture fills an image card, with the
  title, author and chapter count beneath and **Read** under those. The cover is extracted once per session and
  published, so a board of forty cards does not open forty archives before its first paint; a book whose bytes have
  not arrived shows an empty tile rather than a broken picture.

### Fixed

- Dragging a highlight out of a book reaches the board. The carry is released with the gesture whether or not the
  drop lands on the canvas, so a reader cannot end up holding something with no way to put it down, and the concealing
  focus surface lets the pointer through to the board underneath.
- The press that starts a highlight drag no longer selects the shell: the default press began the browser's own text
  selection and the drag then dragged it across the window.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A highlight can be broken into parts. Press one and it is raised: the chapter blurs, the passage sits alone, and a
  range you select can be marked as the card's **title**, as a **property** (created on the promoted type when it is
  missing), or as a **card of its own**. That last one is how a paragraph becomes several notes.
- A right-click on a highlight opens its menu: type, break it apart, place it or open the card it became, copy, remove.
  The raised surface carries the same rows, so there is one action list rather than two.
- A book's **Highlights** panel, beside its contents: the marks you have made, with the ones that became cards marked.
- The library's Annotations tab lists **highlights** rather than only their cards, grouped by book, with a drag
  promoting one onto the board and a press opening the passage.

### Changed

- Placing a highlight that already became a card opens that card instead of making a second one, which used to
  overwrite the record's card and orphan the first. Making another is now an explicit choice.

### Fixed

- A book's cover no longer falls back to an empty tile until a refresh. The cover cache had two states, so "not read
  yet" and "read, no cover" were the same answer, and a first paint that raced an upload gave up for the session.
  It is three states now, and a pending book retries.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- Reading a book on the canvas: an `.epub` dropped onto a board becomes a card, and the reader draws it a
  chapter at a time in the app's own type, with the book's contents in the header. No EPUB dependency: the ZIP
  reader the vault importer already had now lives in `archive/zip.ts` and both use it, and the container,
  package, spine and contents are read on top of it.
- Highlights: select a sentence, press a colour, and the passage is marked. The mark is stored as the words
  themselves, so it survives a resize, a theme change and the same book at another width. Four styles to start,
  shared across every medium, and a style may name a template.
- Pressing a highlight makes an ordinary card that knows where it came from: a read-only `Highlight` property
  points at the passage, the title comes from the first sentence, and the library's new **Annotations** tab is
  every card that came from a mark. A comment on a highlight is the next block in that card's body, because the
  card is a normal card.
- `application/epub+zip` joins the attachment allowlist on both sides, with the extension its download name uses.
- A media block this build has no renderer for now says so instead of drawing a broken image.

### Changed

- The annotation model is written medium-neutral from the first day: the anchor is a `quote`, `page` or `time`
  union and a medium registers itself, so a PDF page and a span of video are a module each rather than a schema
  change. Fake PDF and video media in a test guard that.
- The projection's container copier carries plain JSON values. It dropped them silently, so a share lost every
  payload stored as an object.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A highlight can be broken into parts. Press one and it is raised: the chapter blurs, the passage sits alone, and a
  range you select can be marked as the card's **title**, as a **property** (created on the promoted type when it is
  missing), or as a **card of its own**. That last one is how a paragraph becomes several notes.
- A right-click on a highlight opens its menu: type, break it apart, place it or open the card it became, copy, remove.
  The raised surface carries the same rows, so there is one action list rather than two.
- A book's **Highlights** panel, beside its contents: the marks you have made, with the ones that became cards marked.
- The library's Annotations tab lists **highlights** rather than only their cards, grouped by book, with a drag
  promoting one onto the board and a press opening the passage.

### Changed

- Placing a highlight that already became a card opens that card instead of making a second one, which used to
  overwrite the record's card and orphan the first. Making another is now an explicit choice.

### Fixed

- A book's cover no longer falls back to an empty tile until a refresh. The cover cache had two states, so "not read
  yet" and "read, no cover" were the same answer, and a first paint that raced an upload gave up for the session.
  It is three states now, and a pending book retries.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A book card on the canvas draws the book: the cover fills the card the way a picture fills an image card, with the
  title, author and chapter count beneath and **Read** under those. The cover is extracted once per session and
  published, so a board of forty cards does not open forty archives before its first paint; a book whose bytes have
  not arrived shows an empty tile rather than a broken picture.

### Fixed

- Dragging a highlight out of a book reaches the board. The carry is released with the gesture whether or not the
  drop lands on the canvas, so a reader cannot end up holding something with no way to put it down, and the concealing
  focus surface lets the pointer through to the board underneath.
- The press that starts a highlight drag no longer selects the shell: the default press began the browser's own text
  selection and the drag then dragged it across the window.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A highlight can be broken into parts. Press one and it is raised: the chapter blurs, the passage sits alone, and a
  range you select can be marked as the card's **title**, as a **property** (created on the promoted type when it is
  missing), or as a **card of its own**. That last one is how a paragraph becomes several notes.
- A right-click on a highlight opens its menu: type, break it apart, place it or open the card it became, copy, remove.
  The raised surface carries the same rows, so there is one action list rather than two.
- A book's **Highlights** panel, beside its contents: the marks you have made, with the ones that became cards marked.
- The library's Annotations tab lists **highlights** rather than only their cards, grouped by book, with a drag
  promoting one onto the board and a press opening the passage.

### Changed

- Placing a highlight that already became a card opens that card instead of making a second one, which used to
  overwrite the record's card and orphan the first. Making another is now an explicit choice.

### Fixed

- A book's cover no longer falls back to an empty tile until a refresh. The cover cache had two states, so "not read
  yet" and "read, no cover" were the same answer, and a first paint that raced an upload gave up for the session.
  It is three states now, and a pending book retries.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A book can be uploaded: **New media → Book** on the canvas, or `/media` in a card body. The picker is now the one
  place a media kind is chosen and it serves two targets, so at a caret it inserts and on the canvas it makes a card
  at the point you pressed. The card is made after the file is chosen, so a cancelled dialog leaves nothing behind.
- A book block draws a cover: the title, author and cover picture the package declares, and **Read**. Reading
  happens large, in focus mode, where selecting a sentence is a selection rather than a fight with the editor.
- A highlight can be carried out of the book onto the board: a press that travels picks it up, the book steps aside,
  and a release over the canvas makes the card there. A release anywhere else creates nothing.
- A promoted card now opens with its passage: the quote as a blockquote, then a paragraph naming the source with a
  mention, so the backlink is the graph's own reference.
- A field can be marked read-only. `setProperty` refuses a change from a reader with a named reason, and the one way
  around it is the flag the code that fills the field passes. The flag travels in a share and does not hide a value.

### Changed

- `insertMediaFiles` split into `prepareMediaFile` and an insert, because two targets now need the same upload: the
  permission check, the local copy and the relay attempt live in one place.
- `WorkspaceDocument` gained `bodyNodes`, the reader's pair to `setBodyNodes`, so a surface can draw a block out of a
  body without mounting an editor.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A highlight can be broken into parts. Press one and it is raised: the chapter blurs, the passage sits alone, and a
  range you select can be marked as the card's **title**, as a **property** (created on the promoted type when it is
  missing), or as a **card of its own**. That last one is how a paragraph becomes several notes.
- A right-click on a highlight opens its menu: type, break it apart, place it or open the card it became, copy, remove.
  The raised surface carries the same rows, so there is one action list rather than two.
- A book's **Highlights** panel, beside its contents: the marks you have made, with the ones that became cards marked.
- The library's Annotations tab lists **highlights** rather than only their cards, grouped by book, with a drag
  promoting one onto the board and a press opening the passage.

### Changed

- Placing a highlight that already became a card opens that card instead of making a second one, which used to
  overwrite the record's card and orphan the first. Making another is now an explicit choice.

### Fixed

- A book's cover no longer falls back to an empty tile until a refresh. The cover cache had two states, so "not read
  yet" and "read, no cover" were the same answer, and a first paint that raced an upload gave up for the session.
  It is three states now, and a pending book retries.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A book card on the canvas draws the book: the cover fills the card the way a picture fills an image card, with the
  title, author and chapter count beneath and **Read** under those. The cover is extracted once per session and
  published, so a board of forty cards does not open forty archives before its first paint; a book whose bytes have
  not arrived shows an empty tile rather than a broken picture.

### Fixed

- Dragging a highlight out of a book reaches the board. The carry is released with the gesture whether or not the
  drop lands on the canvas, so a reader cannot end up holding something with no way to put it down, and the concealing
  focus surface lets the pointer through to the board underneath.
- The press that starts a highlight drag no longer selects the shell: the default press began the browser's own text
  selection and the drag then dragged it across the window.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- A highlight can be broken into parts. Press one and it is raised: the chapter blurs, the passage sits alone, and a
  range you select can be marked as the card's **title**, as a **property** (created on the promoted type when it is
  missing), or as a **card of its own**. That last one is how a paragraph becomes several notes.
- A right-click on a highlight opens its menu: type, break it apart, place it or open the card it became, copy, remove.
  The raised surface carries the same rows, so there is one action list rather than two.
- A book's **Highlights** panel, beside its contents: the marks you have made, with the ones that became cards marked.
- The library's Annotations tab lists **highlights** rather than only their cards, grouped by book, with a drag
  promoting one onto the board and a press opening the passage.

### Changed

- Placing a highlight that already became a card opens that card instead of making a second one, which used to
  overwrite the record's card and orphan the first. Making another is now an explicit choice.

### Fixed

- A book's cover no longer falls back to an empty tile until a refresh. The cover cache had two states, so "not read
  yet" and "read, no cover" were the same answer, and a first paint that raced an upload gave up for the session.
  It is three states now, and a pending book retries.

## [Unreleased]

### Added

- Annotation types are editable: a colour, a name, the card type a highlight of that kind produces, and the ordered
  slots it fills. **Types** sits in the library's Annotations tab, and choosing a card type seeds its slots from that
  type's own text properties.
- The raise surface follows the type: one row per slot, empty until words are assigned, filled by selecting them in the
  passage. `Add a part` still maps words the type did not expect, and a part outside the mapping is kept and shown.
- The passage keeps the highlight's colour and its parts are drawn **dotted** in the same colour, so one mark shows its
  internal structure without turning into a patchwork.
- A highlight can be mentioned: `@` offers your highlights beside your cards, the chip names the passage in its colour,
  and pressing it opens where the passage came from. A deleted highlight's chip says it is gone.
- Four starting points for one carry: the passage, the book's Highlights panel, the library's Annotations row, and a
  mention chip. All four reach the same drop, so where a highlight lands is decided once.

## [Unreleased]

### Added

- Read and Edit are two states of the layer. It opens to the data: the presentation fills the window, the
  context is one sentence, and a cell is a value. Edit brings the kinds, the presentation, the grouping, the
  column sorts, the context drawer and the row actions back. A new view always opens in edit.
- A view can be deleted, duplicated and reordered from its rail, with `D` and `Backspace` from the keyboard
  and an Undo in the footer. `deleteView` had existed with no caller since the layer landed.
- A collection can be drawn as a board: the cards where they sit, with the unplaced ones named underneath.
- Grouping by any field, beside section, type and tag, with a count per group; pressing a group or a chart
  bar narrows this reader's surface to it.
- Sorting from a column header, and a peek on any card name in the surface, so reading a view does not need a
  round trip to the board.
- New view of this card, or of these cards, in the canvas menu, which opens a draft whose pins are the
  selection, plus `View: open` and `View: project` in the palette.
- A designed first run: three one-press starters that open a draft rather than a record.
- A handbook inside the app: a float in the corner of the board that lists the articles matching what is on
  screen, counts the things they document, and points a line at the element an article is about. It ships
  behind a development flag while the surface is rough; a production build keeps the floating explain panel,
  so `explain` always has somewhere to send its answer. Resting on a row outlines its subject; opening the
  article keeps the outline, and a subject that is not on this board is opened only on a press.
- `explain` now has somewhere to send its answer. The gathered context renders inside the handbook, a single
  selected thing jumps to its article, several leave the list filtered, and **Point at something** turns the
  next click into a target, including a region of the shell.
- The articles are Markdown in `handbook/`, one per user-facing element and system, rendered by
  `scripts/sync-handbook.mjs` into the app and into the docs site from the same source. The generator refuses
  an article naming an unknown region of the interface, and a documented region with no article.
- The docs site has two entrances, developer documentation and the user handbook, and is built on Fumadocs
  rather than Starlight.
- Feedback is part of the handbook: the same form the launcher uses files a message against the article it
  was opened from, with the article's title attached.

### Changed

- Picking is a projection. `Pick cards` casts the view over the board and leaves the layer; a press on a card
  pins it and a second press unpins it; the float carries Done and Cancel. The separate picking bar is gone,
  so building a context and reading one look like the same thing.
- The projection is a float: draggable, remembered per workspace, and it settles around the dock instead of
  sitting behind it. `views.projection-bar` is now `views.projection-float`.
- The line chart is a line: a path, dots and an axis, rather than a list of numbers.
- The layer has a stylesheet and one chip and one segmented control, over the same tokens the dock and the
  handbook use, and `IconGlyph` icons instead of `◈ ▦ ▸ ×`.
- The library no longer copies a view's query into its own filter state, and is no longer filtered by a
  projection; opening a view opens the layer on it, and the library's filters are the reader's own.
- A lens is no longer a kind. `kind` is `collection` or `render`, projecting is a verb any view can take, and
  a view written before the change reads as a collection with its old payload supplying the projection's
  defaults.
- Editing a saved view is live: field-level setters replace the whole-record write, so concurrent edits to
  different facets converge. `Done` leaves, `Discard my edits` restores the record you opened, and a new view
  stays a local draft until `Create`.
- A view's context is a query *and* the cards you pinned by hand, so it can be built from filters, from a
  selection, or from both, and the read-out says which is which.
- The views controls are an icon in the board's own control row rather than a labelled dropdown, and the bar
  sits after the outline toggle and before search.
- The six heading commands are one accessible menu in the toolbar and one row in the `/` menu. Choosing a
  level sets it rather than toggling it, and `/h3` still applies H3 without opening the menu.
- Pins, the handbook and the projection share one drag gesture and one list of shell obstacles.
- The views surfaces share one development flag (`views/availability.ts`), worded like the handbook's door.

## [0.1.0-alpha.1] - 2026-10-29

The first public release of Suite. The product is the one the hosted deployment runs; what this
release adds is everything somebody outside the project needs in order to trust and run it.

### Added

- The source is public under MIT, with the local gate, the decision-free documentation and the
  deployment scripts as they are used here.
- Plan cards state what a subscription buys: the monthly price from Stripe, the workspace and storage
  allowances, the member count, and the caveats that go with them.
- A self-host card beside the two plans, linking to the deployment guide, because running it yourself
  costs nothing and asks for no licence.
- The alpha notice comes back after ten minutes rather than never: while the product is early, a
  reader who dismissed it last week is the one who most needs reminding.
- The launcher offers the source and an account from the body of the screen, not only from a corner,
  and the copyright line is a link to the repository.
- A plan includes a number of members rather than selling one seat: Personal three, Organization ten,
  at one price and with no per-seat charge. Before this the card's allowance and the invitation check
  disagreed, because the licence row was written from the Stripe quantity, which is always one.
- A `Guests` row on each card and a paragraph under them separate a member (an account, counted)
  from a guest (a share link, not counted), and the caveats now say what a subscription funds.
- `pnpm security:image` runs Trivy against the three images a deployment ships, and the first run
  changed two of them: the runtime stages stop carrying the npm and pnpm CLIs (13 HIGH advisories in
  a tooling tree the application never calls), and the Caddy image upgrades its Alpine packages over
  a CRITICAL brotli decoder overflow. Six HIGH findings remain inside the Caddy binary, which no
  change here can reach; they are named in
  [docs/how-to/release.md](docs/how-to/release.md#the-image-scan).
- `pnpm security:history` scans the whole commit history for credentials, and
  [docs/how-to/publish.md](docs/how-to/publish.md) records the result of the scan that preceded this
  release.
- A billing profile is checked against Stripe before the deployment switches to it, and a saved
  secret is decrypted into the boot environment rather than handed over as ciphertext.

### Changed

- The version line restarts at `0.1.0-alpha.1`. The `v1.x` tags in the history predate the public
  release and describe a private sequence; they are kept because rewriting them would rewrite the
  record, not because they mean 1.0 stability.
- The alpha notice on the launcher and the banner in this file say what is true: sync, collaboration
  and file uploads are what a plan buys, the canvas and export never ask, and payments are real
  monthly subscriptions cancelled from the Stripe portal.

### Fixed

- The plan catalogue is published from the mode the deployment is actually spending, so a live
  deployment no longer serves test price ids beside a live checkout.
- A saved Stripe key is decrypted before a process spends it; the panel had been storing the
  ciphertext and handing it over unchanged.
- The Plan tab reads the catalogue when the host seeds it, so the plans are listed at all.
- The session's active organization decides which organization a page acts in, and a choice made on
  the plan surface is made active.

## [1.1.0] - 2026-10-26

The interface after a period of building. Nothing here is a new capability except
folding and personal organizations; the rest is work that had been built and given
a home in the wrong place.

### Added

- A card folds to its header line and a section folds to its own header. Both are
  reader state, so two people on one board can fold different things away.
- Signing up creates a personal organization named after you and makes it active, so
  the first board joins the relay without a second step.

### Changed

- The navigation lives in one row beside the board tabs: home, undo, redo, version
  history, the outline, and search. Undo and redo left the bottom dock; history left
  the top-right corner.
- The sync control is the only place that answers whether the work is safe: the
  connection, unsent changes, this device's copy, the relay's room name, the storage
  warning and the storage surface are rows in it.
- Signed out reads as `Local`, not as `No access`.
- The outline is hidden while a board has no sections.
- Camera controls are React Flow's own pill plus zoom-to-selection. The zoom readout,
  the outline button and the dot grid switch are gone, and the grid is always drawn.

### Removed

- The rollup rail and everything behind it. It existed because neither a card nor a
  section could collapse; both can now.
- Better Auth anonymous sessions, the transfer hook that moved their workspaces on
  sign-up, the prompt that announced it, and the adoption of anonymous organizations.
  A browser with no session has no session, which is what it means to be local.
- The connection pill, the save pill and the storage warning banner that floated over
  every board.

### Fixed

- A local board reported "this workspace refused this browser's access" on every
  run. The relay refuses a token with no organization, and the app booted an
  anonymous session that could never have one. Local storage was working the whole
  time.
- An account held an organization it never acted in. Better Auth's
  `createOrganization` leaves `activeOrganizationId` null, so every join was refused
  for a signed-in account too.

## [1.0.2] - 2026-10-26

Making the local stack explain itself. Four defects, all of the same kind: something
was built and nothing said how to reach it.

### Added

- `pnpm check:env` reports Node, pnpm, Docker, Postgres on 5433, accounts, billing,
  the Stripe CLI and each of the three processes, one line each. Every failing line
  names the single command that fixes it.
- `pnpm stripe --login` runs the browser login and then creates the fixture prices,
  which is what a first run actually wants.

### Fixed

- `.env.example` and the generated `.env` named `pnpm dev:stripe`, a script that had
  been deleted, sending a reader after a command that never existed.
- `pnpm stripe` stopped dead on a missing CLI. It now prints the install line for the
  platform and the separate login step, and a missing test key names both ways to get
  one.
- `docs/tutorials/run-locally.md` implied Stripe was part of getting started. Signing
  in needs none of it, so the page now separates the two paths.
- `e2e-grep.txt`, a scratch file committed by accident, is gone.

## [1.0.1] - 2026-10-26

A local run can sign in and pay in test mode. `pnpm dev` started three processes
that could not see each other, and the account surface reported itself
unavailable in every development session.

### Added

- A dev proxy in `apps/canvas/vite.config.ts` that forwards the account mounts,
  billing, the relay's HTTP API and the socket to their own processes, so the
  page, the API and the socket answer on one origin. The session cookie is
  first-party, which is the same shape Caddy provides in a deployment.
- `pnpm dev:env`, which writes a `.env` with accounts on and a generated session
  secret, and refuses to overwrite an existing one.
- `pnpm dev:db`, which publishes Postgres on port 5433 through
  `compose.dev.yaml`. The base compose file still keeps it off the network.
- `SUITE_AUTH_REQUIRE_VERIFICATION`. Verification is required and the console
  mail transport redacts the token it prints, so without this a local sign-up
  cannot be completed. It defaults on; only `0` or `false` turns it off.
- Both server processes read the repo `.env` through `--env-file-if-exists`.

### Fixed

- The billing block in `.env.example` documented seven variables nothing reads:
  the stored-event and DynamoDB switches, the licence private key, the app
  origin, and the SES pair. They went with the hand-written webhook.

## [1.0.0] - 2026-10-26

The first release with accounts. Two processes, one identity, and a payment path
that can be completed in test mode without touching the Stripe dashboard.

### Added

- `apps/control-plane`: a second server process that owns Postgres, Better Auth
  and Stripe. It mounts route modules it does not know by name, so the relay
  keeps its sockets, its SQLite stores and its projection and gained no `pg`
  dependency.
- Sign-up in the browser: email and password, magic link, passkeys and Google.
  Email verification is required, Turnstile is used when configured, and the
  sign-in route is rate limited.
- Organizations, members with roles, invitations, a device list with revoke, and
  MFA for admin actions.
- Billing through `@better-auth/stripe`: checkout, the customer portal, the
  webhook, trials and plan limits. `pnpm stripe` sets up the fixtures and
  `pnpm stripe --listen` forwards deliveries to the control plane.
- A session JWT minted by Better Auth's `jwt()` plugin and verified at the relay
  against a cached JWKS. Five-minute TTL, re-minted on every room join.
- Account export and account deletion, with a per-store report of what was
  removed and what was not.
- `packages/licence`: the licence token format and its Ed25519 verifier, shared
  by the relay and the billing service.
- `SUITE_LICENCE`: a self-hosted instance takes a signed licence at boot and
  runs at its tier. An expired, wrong-key or malformed token refuses to start.
- `apps/site`: the marketing page at `suite.run`. `apps/docs` moved to Astro and
  Starlight, still serving the dashboard, the four sections, `llms.txt`,
  `llms-full.txt` and Markdown for every page.
- A toast layer and a live-region announcer; a connection banner that
  distinguishes "not authorised" from "offline"; a save indicator separate from
  the sync dot.
- An Obsidian vault importer: folders become boards, `.canvas` geometry becomes
  placements, frontmatter maps onto type fields, wikilinks resolve, and every
  loss is reported.
- Version history with a revertable restore, starter templates, annotations
  anchored on a quote, type blueprints installed as a name-keyed diff, hover
  peek, a rollup summary, radial layout, and a closed error-code catalogue.
- Published cards have a slug and a reader URL that survives a reload and needs
  no account.
- `deploy/stripe/`: fixtures, a setup script and a test clock for renewals.

### Changed

- A persisted document is written off the event loop, by a worker that owns the
  only write connection and applies batches in arrival order.
- A projection rebuild writes only the entries that differ. Share build p50 fell
  from 20.5 s to 2.0 s on the load fixture; socket p99 from 862 ms to 22 ms.
- Every store sets WAL, `busy_timeout` and a schema stamp, and refuses a file
  stamped by a newer build.
- Peer, document, card, projection-build and per-room backpressure limits are
  enforced with named codes and published from the constants.
- The container runs non-root with a read-only root filesystem, no added
  capabilities and resource limits.

### Fixed

- A board above roughly 240 cards never reached a peer: the relay's join backfill
  sent one `DocUpdate` that `loro-protocol` refuses to encode above 256 KiB. The
  relay now fragments, and a 2.1 MiB board syncs.
- Arrow keys moved a focused card and the move was never saved.
- A fresh deployment could not create its first organization, because a seat
  check read a licence row nothing wrote.
- A paying organization was enforced at the free tier, because a subscription
  never reached `organization_licences`.
- Six menus never took focus, so their arrow keys were dead. Five dialogs
  declared `aria-modal` without a trap. Library rows were pointer-only.
- The in-app reduced-motion setting never reached JavaScript.

### Removed

- The owner key, in full: the claim, rotate and status routes, the URL fragment,
  `.suitekey` files, 24-word recovery phrases, `reset-owner`, and the
  `workspaces.sqlite` owner hash. There is no migration; see the upgrade notes.
- The hand-written Stripe webhook, checkout, portal, event verification and
  store, replaced by the plugin.

### Upgrade notes

This release cannot read a workspace that was shared by owner key.

- A `.suitekey` file or a 24-word recovery phrase no longer opens anything.
- A URL containing `#owner=` is treated as a plain workspace URL.
- An anonymous workspace opens, edits and exports as before, and does not sync.
  It is local-only until an account claims it, which is also when it can be paid
  for. Claiming does not change the workspace id.
- A deployment moving from `0.2.0-beta.1` keeps its six SQLite stores. Postgres
  is new: run the migrations by starting the control plane with
  `SUITE_AUTH_MIGRATE` on, which is the default.
- Billing now reads `STRIPE_PRICE_TIERS` and the plugin's table. The retired
  `SUITE_BILLING_STORE=dynamodb` and `SUITE_BILLING_TABLE` are ignored.

## [0.2.0-beta.1] - 2026-10-26

The first Beta line. Docs are the four Diátaxis sections plus a dashboard, the
docs site serves the same Markdown, and the e2e suite has a fast smoke gate.

### Added

- `apps/docs`: a Fumadocs site over `docs/`, with full-text search, a tabbed
  dashboard, `llms.txt`, `llms-full.txt` and a Markdown view of every page.
- `pnpm check` (lint, typecheck, changed tests), `pnpm e2e:smoke` (critical
  paths) and `pnpm e2e:changed` (specs changed since `origin/main`).
- `pnpm docs:check` now also verifies the generated section indexes and the
  house prose rules.
- `scripts/sync-docs.mjs` and `scripts/generate-doc-indexes.mjs` keep the site
  and the section indexes derived from `docs/`.

### Changed

- Documentation is `docs/README.md` plus `tutorials/`, `how-to/`, `reference/`
  and `explanation/`. Decision records, programme roadmaps and design history
  live in the local-only `internal/` tree.
- `@suite/graph` is split into domain modules behind `WorkspaceDocument`;
  `apps/canvas` feature folders replace the flat `components/` directory; the
  relay and the auth/billing services are folderised.
- The default test loop is `pnpm check`. Full e2e is a deliberate gate before a
  big commit, a merge or a tag.

## [0.2.0-alpha.1] - 2026-10-23

The first tagged alpha. Everything here is usable self-hosted; hosted billing is
not open.

### Added

- Attachments: image bytes stored by the relay, uploaded and served per
  workspace, included in backup and restore.
- Multi-tab safety: one writer per workspace via Web Locks, with a
  version-vector fallback, so two tabs cannot delete each other's unmerged
  edits.
- Client durability: an error boundary around the canvas, `persist()` with a
  visible storage state, a typed quota path instead of a silent failed save, and
  an explicit offline scope ("the open tab keeps working; a reload while
  offline is not supported in Alpha").
- A local diagnostics bundle and opt-in crash reporting against a self-hosted
  GlitchTip profile, off by default.
- A blob format tag on stored snapshots, plus N−1 workspace and per-store
  fixture tests.
- `docs/limits.md`, generated from the enforcement code and checked for drift.
- `docs/release.md`: tag, image, rollback and smoke procedure.
- `scripts/docs-check.mjs`: link, code-fence, retired-term and version checks.
- `LICENSE` (MIT), `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`.
- Dependabot for `npm`, weekly and grouped.
- A tag-driven release workflow that pushes the runtime image to GHCR and
  opens a GitHub release with the changelog section and image digest.
- Portals: a portal card points at another board, renders a snapshot miniature,
  and enters it through a 320 ms camera transition with a back stack. Peer dots
  appear on portal cards and board tabs.
- Card focus: double-clicking a card, or choosing Edit in the inspector, opens
  the same card surface over the canvas; Escape restores the board.
- Workspace identity: the title bar shows an editable workspace name, new
  workspaces get a friendly default, and the browser title follows the name.
- A single-icon theme menu (Light, Dark, Auto) with a reduced-motion-aware
  sun/moon transition; Views is a text menu beside the workspace name.
- The `/`, `@`, and context menus scroll/flip to keep the active row and
  submenu visible, and app-bar controls share one 24 px row.
- The build version is reported by `/api/admin/status` and `/metrics`
  (`suite_build_info`).

### Changed

- The workspace document layer is `WorkspaceDocument` and its React binding is
  `useWorkspaceSnapshot`; the old names are gone from the docs as well as the
  code.
- `README.md`, `AGENTS.md`, `docs/testing.md` and `docs/billing.md` describe the
  product that exists: six stores, attachments shipped, current test counts.
- Marquee selection is covered by a regression spec, and local drag easing is
  render-only with one CRDT commit per gesture.

### Fixed

- Settings, licence claims and attachments were lost when a container was
  recreated; all six stores are configured on the `suite-data` volume, and
  `SUITE_REQUIRE_DURABLE_STORES=1` refuses a disposable layout at boot.
- Opening a second client could loop on an uncached board-presence object; the
  map is now memoised on the peer set.
- A deleted workspace could be written back by its live room seconds later; the
  room is closed on delete.
- The stale light preview asset, which showed the retired sync engine, is
  removed.

### Removed

- Hosted checkout is closed for the alpha: the Stripe webhook is not deployed,
  `SUITE_BILLING_ENABLED` defaults to `0`, and no upgrade CTA exists in the app.

## Version 0.1.0

The untagged pre-alpha line. No release artifact was published; `package.json`
carried `0.1.0` while the tree was the only distribution.
