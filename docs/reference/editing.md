# Editing

How card text, fields, templates and reference chips are stored and edited; the document model underneath is in [architecture.md](architecture.md).

## Title and body

A card owns two rich-text containers. The title is a single paragraph in `titles`, the body is a document in `content`, and both are mergeable maps keyed by card id inside the workspace document.

`CardTitleEditor` and `CardBodyEditor` in `apps/canvas/src/cards/CardBodyEditor.tsx` are the only components that mount them. The title editor is shared by the canvas card and the panel, so the Enter, blur and Escape contract has one implementation: Enter commits unless the `@` picker is open and consuming the key, and an empty title draws the "Untitled" placeholder as decoration, never as text.

The split keeps the two edit sessions apart. A title is short, single-line and read on every card face; a body is long and mounted only on the surface that owns the edit. Keeping them apart means renaming a card does not touch its body container, and the two have separate undo origins.

## The rich-text model

The editor is Tiptap over ProseMirror, bound to Loro by `loro-prosemirror`. `LoroCollaboration` in `apps/canvas/src/editor/LoroCollaboration.ts` adds three plugins and no schema: `LoroSyncPlugin` mirrors one container into the editor state, `LoroUndoPlugin` supplies the undo stack, and `LoroEphemeralCursorPlugin` publishes carets on the shared cursor store. Each editor binds exactly one container, so a body edit and a title edit are separate transactions with separate origins (`text:body` and `text:title`).

The schema lives in `apps/canvas/src/editor/cardEditorExtensions.ts`, apart from the collaboration plugin, so `editorSchemaContract.test.ts` can build the same schema without a document and compare it with the publish allowlist.

| Node | File | What it stores |
| --- | --- | --- |
| `paragraph`, `heading`, headings' lists, `blockquote`, `codeBlock`, `horizontalRule`, `hardBreak` | Tiptap `StarterKit` | Text and its block structure |
| `mention` | `apps/canvas/src/editor/Mention.ts` | A target card id, an optional field id, an optional display template |
| `propertyBlock` | `apps/canvas/src/editor/PropertyBlock.ts` | A field id and an optional display template |
| `media` | `apps/canvas/src/editor/mediaNode.ts` | A `kind` of `image`, `video` or `youtube`, plus the attributes that kind needs |
| `attachment` | `apps/canvas/src/editor/attachmentNode.ts` | Metadata for bytes held beside the document |
| `image` | `apps/canvas/src/editor/imageLinkNode.tsx` | A URL, alt text and a size |
| `video`, `youtube` | `apps/canvas/src/editor/videoNode.tsx`, `youtubeNode.tsx` | Video bytes beside the document; a video id and embed source |
| `tourStep` | `apps/canvas/src/editor/TourStep.ts` | Step id, targets, camera, caption and advance rule |

Marks are the Tiptap defaults: `bold`, `italic`, `strike`, `code`, `link`, `underline`.

## One table, three surfaces

`apps/canvas/src/cards/formatCommands.ts` holds `FORMAT_COMMANDS`, and every formatting control draws from it: bold, italic, strikethrough, six heading levels, two lists, quote, code block and divider. Each entry carries its glyph, its name, its `/` keywords, its Tiptap command and the predicate that decides whether it is pressed where the caret sits.

The table exists because the three surfaces had drifted. The `/` menu offered six heading levels, a quote, a code block and a divider; the toolbar offered three levels and no quote; the bubble inherited whatever the toolbar had. A command available in one place and missing from another is a question the reader has to answer twice, so the renderers became readers of the table instead:

| Surface | File | Placement |
| --- | --- | --- |
| Bubble | `EditorToolbar` inside a `BubbleMenu` | Rides the selection on a canvas card |
| Inline row | `EditorToolbar` with `toolbarPlacement="inline"` | Above the text in the inspector and the card panel |
| `/` menu | `SLASH_ITEMS` in `SlashCommands.ts` | Under the caret, filtered by the typed query |

`activeCommands(editor)` turns the table into the pressed state the toolbar reads through `useEditorState`, so neither surface keeps its own list of `isActive` calls.

Insert-only rows are the exception, and only the `/` menu has them: image from URL, mention and property. They add content rather than change the look of what is selected, so a toolbar button for one would be a second way to do something that already has a gesture.

All three surfaces wrap. The inline row wraps inside its column, the bubble is capped at `min(100vw - 2rem, 18rem)` so a narrow card gets two rows instead of a row past its edge, and the `/` menu narrows with the window (`min(260px, 100vw - 16px)`) and shortens to `min(300px, 60vh)`.

A click on a card's title or body starts editing, rather than a double-click. Double-click is now only the tour gesture: on a card that is a tour, a single click does nothing and a double-click plays it, so an ordinary press cannot start a presentation. A body click also requires the pointer to have stayed within four pixels of where it went down, so dragging a card by its text still moves it instead of opening the editor.

That one press does two things: it puts the caret where it landed and opens the inspector beside it. The edit used to stop the click before the second half happened, which left the panel reachable only from a press on the card's frame. The toolbar's `interactionMode` decides between the halves — see [ui.md](./ui.md#what-a-press-on-a-card-does).

`packages/graph/src/publish/validation/richTextSchema.ts` is the allowlist a published body is checked against: node names, mark names and the attributes each node may carry. Adding a node or an attribute to the editor without extending it fails `editorSchemaContract.test.ts`, which is the point.

A publish validates against that allowlist because a share projection copies content into a different document. The mentions and blocks in a shared body resolve against the copy, so a chip can point at a card the viewer cannot open; those render as inert with the title the projection kept.

## Reading and committing a value

The draft control in `PropertyField.tsx` never writes on every keystroke. Enter blurs the input and the blur commits; Escape restores the stored value, marks the edit cancelled and blurs; a blur that follows a real change commits it, and a blur that does not ends the edit without a write. A number or date that fails to parse calls `onCancel`, so an invalid value is discarded rather than stored as text.

The card surface around an inline control keeps the session alive across a re-render. `CardPanel` and `NodeCard` hold the blur in a 120 ms timer and cancel it when focus comes back, because a presence update or a sync tick can blur and refocus the editor without the reader having left. Without that grace period a collaborator's cursor movement would end the edit under the writer.

Editing is also exclusive per card. `editingField` and `editingSurface` in `apps/canvas/src/store/useUiStore.ts` decide which of the title, the body or the inspector owns the caret, so a card mounted on two surfaces has one editor with a caret and one read-only copy.

## The `@` picker

`@` opens the mention picker in the title and in the body. `apps/canvas/src/editor/SuggestionList.tsx` renders it outside the React tree, which is why the keyboard rules live in its `onKeyDown` rather than in a component:

| Key | Effect |
| --- | --- |
| `ArrowDown`, `ArrowUp` | Move the highlight, wrapping at both ends |
| `ArrowRight` or `.` | Enter the highlighted card's fields |
| `ArrowLeft` | Leave a field list and return to its card |
| `Enter` | Insert the highlighted row and close the picker |
| `Escape` | Close the picker and leave the query text alone |

Hovering a row moves the highlight. It never opens a submenu, because a list that changes shape under the pointer makes the next keystroke land on a different row.

Three row kinds exist. A card inserts a `mention`; a field of the card being edited inserts a `propertyBlock`, which edits that field in place; a field of another card inserts a mention carrying a `fieldId`. The third form is what a reader writes as `@card.field`, and it reads the other card's value live.

## The `/` menu

`/` opens the block menu from `apps/canvas/src/editor/SlashCommands.ts`. Every row of `FORMAT_COMMANDS` appears in it, in table order, followed by the three insert-only rows: Media, Mention and Property.

There is no Tour step row while tours are paused. The `tourStep` node, its schema entry and `presentTour` all stay; only the menu row that advertised a paused feature is gone, and the block can still be inserted directly.

A heading row converts rather than toggles: `/h1` inside an H1 keeps it an H1, where the toolbar button removes the level. That is the one place the two behaviours differ, and it is `slashRun` on the table entry.

Each row runs a command against the current block after deleting the typed `/query`, so the query never becomes text. The menu keeps the editor's selection while a row is clicked: `onMouseDown` on the list calls `preventDefault`, because a focus change would collapse the range the command needs.

Most rows answer in place. Media is the exception: it opens `MediaPickerHost`, one dialog listing the four ways to add media: image upload, video upload, YouTube and image link. The kind of media is the question, and asking it four times in a row in the menu was the drift the shared table exists to prevent. The toolbar's Media button opens the same dialog, so `/` is never the only way in. Once a kind is chosen, the picture or the address is still asked for in place: `ImageUrlPrompt` sits in the editor, so the caret and the editing session survive the answer.

## Media

New content is written as one `media` block. `kind` decides which of the four renderers draws it, and the attributes are the union of what the four it replaced carried, so nothing a document already knew is lost. Where the bytes are is data, not schema: an image with an `id` is served by the relay, and an image with a `src` is fetched from a third party.

`attachment`, `image`, `video` and `youtube` stay in the schema and stay publishable. A document written before `media` existed must keep rendering, so removing them would lose media a reader can still see. `migrateLegacyMedia` converts them the first time a body is opened for editing. It is one transaction, proposed only when there is something to convert, so an untouched body writes nothing and an extra undo entry never appears. An inline `attachment` converts only when it is the whole paragraph, because `media` is a block: the alternative is either a schema error or splitting prose the reader wrote.

A stored `media` block names an id, a MIME type, dimensions and a name, while the bytes live in IndexedDB and, when a relay is configured, on the relay. A share projection copies the metadata and not the pixels, which is what keeps a shared document small; a viewer without the bytes sees the upload state instead of a broken image.

A link `media` block stores a URL, alt text and a size. It works with no relay at all, which is why a standalone build can still hold a picture.

Pasting an image runs `PasteImages`, which measures the image, stores the bytes locally, uploads when a relay exists, and marks the node uploaded when the upload lands. A failed upload leaves the local copy in place, so the picture survives a reload. When the relay answers with a stated refusal (a 401, or a 403 for a workspace whose plan excludes uploads), the refusal is raised as a prompt rather than swallowed, because a card that looks uploaded and is not is the worst of the three outcomes.

A media card is the same reference, not a copy. A card of the media type holds one media block in its
body, made from a library row with "Place as card"; the bytes stay where they are and the card points at
them. It is created unplaced, so it starts in the Inbox and the reader chooses a board, which is what makes
media something that can be placed, duplicated, linked and used as a field value.

`media` and `sketch` are field kinds that narrow a card reference by type. The value is the card id a `card`
field already holds, and `allowedTypeIds` on the definition is the rule, so the graph package needs no
knowledge of which types exist. A field that names no types narrows nothing, and a caller that cannot say
what type a card is skips the check rather than refusing a value the document already holds.

## The face a card shows before it is focused

`StaticCardFace` draws the same body without an editor, and it draws media itself: an image at the relay or at its own address with `loading="lazy"`, `decoding="async"` and the size the node recorded, so a picture arriving late cannot reflow the card; a video with `preload="metadata"`; an embed as its poster still rather than an iframe, because one iframe per card is the cost that made this path worth special-casing. Anything with nothing to point at keeps a labelled chip instead of a blank line.

## Read-only surfaces

A card face, a search result and a shared document render the same content without an editor. `CardBodyEditor` takes `readOnly`, which leaves the placeholder out and never focuses the editor; the title editor draws "Untitled" as decorative text instead. A read-only property block closes the panel instead of opening an inline control.

Nothing about the read path formats a field by hand. Values go through `formatPropertyValue`, which is also what produces the unavailable and not-shared labels a share needs.

## Fields

A field is a `FieldDefinition`: id, name, kind, required flag, order, select options, optional sub-fields and the rating scale. Definitions belong to a type. Values belong to a card, in `card.properties`, keyed by field id.

`fieldKinds` in `packages/graph/src/schema.ts` is the closed set:

| Kind | Stored value |
| --- | --- |
| `text`, `date` | `string`; a date is `YYYY-MM-DD` and must be a real calendar day |
| `number` | finite `number` |
| `checkbox` | `boolean` |
| `select` | option id |
| `multiSelect` | array of option ids |
| `card` | card id |
| `board` | board id |
| `rating` | `number` with the field's scale |
| `group` | record of sub-field id to value |
| `list` | array of values or of group records |

Writes go through `WorkspaceDocument.setProperty(cardId, fieldId, value)` and `clearProperty`. Passing `null` clears, which is different from storing an empty string: `isPropertyValueEmpty` treats a blank text value as unanswered, and a deleted select option stays stored while it reads as unavailable.

Sub-fields are addressed as `<fieldId>:<subId>` when a group or list renders them, so two groups can both hold a "Page" sub-field without colliding.

## Rendering a field

`FieldValueInput` in `apps/canvas/src/cards/PropertyField.tsx` is the one control set. It owns the parse and commit rules for `text`, `date`, `number`, `checkbox`, `select`, `multiSelect`, `card` and `board`, so the inspector, the inline property block and any future cell cannot disagree about what a date is or what clearing means.

A composing kind registers an editor instead. `registerFieldKind` in `apps/canvas/src/field/fieldKindRegistry.tsx` maps a kind name to a component, and `apps/canvas/src/field/compositeKinds.tsx` registers `rating`, `group` and `list` at module scope. Importing a module is what makes its kind exist, and `PropertyField.tsx` imports the composing kinds beside the switch, so a composite kind ships without editing the inspector and without each caller registering it.

A read-only surface never formats a value itself. `readPropertyValue` and `formatPropertyValue` in `packages/graph/src/property.ts` produce the text, including the unavailable and not-shared labels, and the registry deliberately has no format function: two formatters for one value drifted, and the group summary in the registry counted a blank sub-field as filled while the graph did not.

## Display templates

A display template decides how one value reads where it appears: literal text plus `{{label}}`, `{{value}}`, `{{card}}` and `{{type}}`. `packages/graph/src/template.ts` parses it into segments, `ValueTemplate` in `apps/canvas/src/cards/ValueTemplate.tsx` renders them with the label muted, and nothing richer is possible because a template is not markup.

Templates are stored per field (`display`), and a single mention or property block may carry its own override. `DISPLAY_PRESETS` supplies the buttons in `DisplayStyleDialog`; the field default is `{{label}} · {{value}}` for a block and `@{{card}} · {{value}}` for a mention chip, because a chip is a reference from somewhere else and a bare name would not say where to. The maximum length is 160 characters.

Empty values render as `EMPTY_VALUE_TEXT`, a single em dash, so a template never shows a dangling prefix.

## Cards and templates

A card is identity plus `typeIds`, `properties`, `tags`, and its two text containers. It exists without a board, and a board shows it through a placement.

Templates duplicate. Using a board template copies its cards into a new board with a name like `Recipe 2`, and a type blueprint is itself a card that a new type copies its fields from. Nothing keeps a link between a template and what it produced (ADR-0038, ADR-0059).

## References

A reference is derived, never stored. `packages/graph/src/references.ts` walks card content for `mention` nodes, reads the `cardId` from the node's attributes map, and adds card-valued fields, so `WorkspaceDocument.referencesFor(cardId)` answers "who points at this" without a relation store (ADR-0019).

Edges are separate. An arrow between two cards carries a name and a path, no payload, and no reference row (ADR-0062). That keeps "this mentions that" and "this is drawn next to that" from being the same fact.

Deleting a target leaves the mention in place. The chip reads the target live, so a missing card renders as "Unavailable card" and a projection that kept no title renders as "Not shared"; neither case silently deletes the text the reader wrote.

## Mention chips

`@` opens one picker shared by the title and the body. Rows come from `apps/canvas/src/editor/SuggestionList.tsx`: a card inserts a chip, a field of the current card inserts a property block, and a field of another card inserts a `@card.field` chip.

The chip stores the target id, the field id when there is one, and the per-mention display override. It reads the title, the field name and the value live through `useCard` and `useCardTitle`, so a rename shows up in every mention. `MentionChipNodeView` in `apps/canvas/src/editor/MentionChip.tsx` stops double-click propagation so a chip inside a card does not open the card behind it.

Clicking a chip navigates or reveals: a card target opens it, a field target opens the inspector on that field through `focusTarget`. Renaming, retyping or deleting the target never rewrites the chip.

## Undo boundaries

Each editor owns its undo stack. `LoroUndoPlugin` builds an `UndoManager` per editor with a 1000 ms merge interval and 100 steps, and excludes origins that belong to another surface: the body excludes `text:title`, the title excludes `text:body`, and both exclude `struct:` and `sys:init`. `Mod-z`, `Mod-y` and `Mod-Shift-z` are bound in `LoroCollaboration`.

Structural edits are named `struct:` precisely so they stay out of the text undo stack. Creating a card, dropping a placement or removing a section commits once at the end of the gesture, so one `Mod-z` reverses the whole move instead of one record at a time.

Undo is therefore scoped to the surface that has focus, and it never reaches into another card's text. What a keystroke will undo is decided by which editor the caret is in.

## Where the pieces live

| Concern | File |
| --- | --- |
| Body schema and extensions | `apps/canvas/src/editor/cardEditorExtensions.ts` |
| Collaboration plugins and undo | `apps/canvas/src/editor/LoroCollaboration.ts` |
| Body and title editors | `apps/canvas/src/cards/CardBodyEditor.tsx` |
| Field control set | `apps/canvas/src/cards/PropertyField.tsx` |
| Composite kinds | `apps/canvas/src/field/compositeKinds.tsx` |
| Field kind registry | `apps/canvas/src/field/fieldKindRegistry.tsx` |
| Templates and presets | `packages/graph/src/template.ts` |
| Value formatting | `packages/graph/src/property.ts` |
| Reference index | `packages/graph/src/references.ts` |


## What covers this

| Behaviour | Test |
| --- | --- |
| Editor schema against the publish allowlist | `apps/canvas/src/editor/editorSchemaContract.test.ts` |
| Mention node attributes and resolution | `apps/canvas/src/editor/Mention.test.ts` |
| Mention chip rendering, display override | `apps/canvas/src/editor/MentionChip.test.tsx` |
| Slash menu rows and commands | `apps/canvas/src/editor/SlashCommands.test.ts` |
| Field controls and commit rules | `apps/canvas/src/cards/PropertyField.test.tsx` |
| Composite kinds | `apps/canvas/src/field/compositeKinds.test.tsx` |
| Card panel tabs and editing | `apps/canvas/src/cards/CardPanel.test.tsx` |
| Card gestures and the title gesture | `apps/canvas/src/cards/NodeCard.test.tsx` |
| Display templates | `packages/graph/src/template.test.ts` |
| Value formatting | `packages/graph/src/property.test.ts` |

The procedure for adding a node, a mark, a field renderer or a command is in [change-the-editor.md](../how-to/change-the-editor.md).
