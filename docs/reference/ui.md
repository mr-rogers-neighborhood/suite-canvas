# Interface

How the shell, the library, the panels, the styling surfaces and the command palette are assembled, and the focus, keyboard and theme rules they share; the document they read is described in [architecture.md](architecture.md).

## Shell composition

`apps/canvas/src/App.tsx` renders the shell in one column. The title bar sits at the top, the board fills the middle, and the dock and the library drawer sit over its bottom-left corner. The outline rail, the inspector, the card focus and the tour overlay are children of the board area, so they open in the same stacking context as the canvas; the dock, the drawer, the palette and the dialogs are siblings that portal or float above it.

| Surface | Component | What it owns |
| --- | --- | --- |
| Title bar | `apps/canvas/src/chrome/TitleBar.tsx` | Workspace name and rename, the command bar, sync and storage status, the workspace menu, the account slot, the theme toggle |
| Board tabs | `apps/canvas/src/chrome/BoardTabs.tsx` | Open boards, the home board, per-board peer counts, board close and rename |
| Views bar | `apps/canvas/src/chrome/ViewsBar.tsx` | Saved views, applying one, renaming and deleting one |
| Dock | `apps/canvas/src/chrome/Dock.tsx` | Library toggle with the inbox count, new card, new sketch, new section, new portal, type settings |
| Outline rail | `apps/canvas/src/canvas/BoardOutline.tsx` | The active board's section tree, in reading order, with counts and presence |
| Rollup rail | `apps/canvas/src/app/RollupSummaryHost.tsx` | The card in front of the reader as its header line and the count it hides |
| Inspector | `apps/canvas/src/cards/CardInspectorHost.tsx` | The one panel for the selected card or container |
| Blueprint install | `apps/canvas/src/app/BlueprintInstallHost.tsx` | The type a card's title and body declare, previewed before it is written |
| Library drawer | `apps/canvas/src/library/LibraryDrawer.tsx` | Every card, board and trashed record, with search and facets |
| Command palette | `apps/canvas/src/command/CommandPalette.tsx` | Navigation and actions from one query |
| Presence | `apps/canvas/src/presence/` and `apps/canvas/src/cursor/` | Peer cursors, name tags, avatars and the status cursor |
| Account | `apps/canvas/src/auth/SignInEntry.tsx` and `AccountPanel.tsx` | Sign in or the account menu, and one dialog for the account, members, devices and the plan |
| Launcher | `apps/canvas/src/launcher/WorkspaceLauncher.tsx` | Recents with rename, export and delete, import, and the same account entry the title bar has |

The shell holds no document data. Selection, the active board, open tabs, filters, the open surface and the palette query live in `apps/canvas/src/store/useUiStore.ts`; the document arrives through `useWorkspaceSnapshot`.

## The library

The drawer has four tabs: `inbox` (cards on no board), `cards`, `boards` and `trash`. `apps/canvas/src/library/libraryFilters.ts` defines the facets: type, tag and section, with OR inside a facet and AND across facets. The section facet appears only when the drawer is scoped to one board, because a section title means nothing outside its board.

Search and facets feed the same list. A saved view fills those same controls through `applyView`, so there is one filtering model and no second query language (ADR-0037).

Rows share one action menu, opened from the `⋯` button or a right-click, and one piece of state (`rowMenu`), so both entry points cannot show different actions for the same row. A card row can be dragged onto the canvas: the hold and drop run through `useLibraryHold`, and the drop places the card at the pointer instead of at the drawer.

A row also holds an open button, and that button is the row's tab stop. Enter opens the card or the board; `ArrowUp`, `ArrowDown`, `Home` and `End` move between rows through `rowsKeyDown`; the `⋯` menu is how a keyboard reaches Place, Trash and the rest. The pointer gesture is unchanged: a press on the title still lifts the row for a drag, because the open button ignores pointer activations and only answers a keyboard click.

`library-sort` chooses title, recently updated or relevance, and `useLibraryList` applies it to whatever the facets and the query left. Relevance is the search ranking, so a list with no query keeps its facet order. A search that reaches the 200-hit cap in `hooks/useLibrarySearch.ts` says so above the rows, because a list that stops at 200 otherwise reads as complete.

Deleting a trashed card for good asks in the app's own `Dialog`, through `pendingPurge` in `LibraryDrawer`. `useLibraryRowActions` only reports the request, because the menu is data and has no component to host a dialog.

`libraryFull` widens the drawer to the whole window for browsing; the floating width stays the default because a row has to be draggable onto the canvas beside it. `LibrarySelectionBar` appears with the selection mode, not with the first row, and offers placing the selection as a run.

## Board navigation

Board tabs are a navigation, not a tab strip. Switching a board replaces the canvas, so the active tab carries `aria-current="page"`, and the strip can hold the close button and the inline rename field it needs without breaking required children. A back control appears when the visit history has somewhere to go; the history records the board and the viewport, so returning restores both.

The home board is a tab that is always reachable when it is not the active one. A portal's entry and the library's "go to board" both go through the same activation path, which is why the back stack exists for every route into another board.

Peers show on tabs as small avatars, aggregated per board, so "where is everyone" is answerable without opening the outline.

## Panels

One inspector exists. `CardPanel` renders in two variants, `inspector` (docked beside the canvas) and `embedded` (inside a card focus), and both read the same card model, so a property can be fixed without going to the canvas (ADR-0050).

Its tab strip has Details, Content and Style. Details carries the type and tag pickers, the properties, the placement and the links; Content is the body editor, or the step list for a tutorial; Style is the per-card style surface. The strip behaves as one tab stop with arrow-key movement, and the selected tab is the only one with `tabIndex=0`.

`ContainerPanel` covers the container selection (section or portal), `LinkInspector` covers one edge, and `ExplainPanel` shows the explain context. `TypeSettingsDialog` edits the type registry and its fields. Each of these writes through `@suite/graph`; none keeps a copy of the record it edits.

Two panels read a card's metadata without owning it. `apps/canvas/src/panels/AnnotationReader.tsx` shows the passage an annotation card points into, resolved against the source's text (ADR-0072). A record keeps the quoted text and the offsets it was captured at; the quote is the anchor and the offsets are a hint, so an edit above the passage shifts the range silently. Stale means one thing: the source no longer contains the quote at all, or the source card is gone. Only that state asks the reader to act. `apps/canvas/src/panels/BlueprintInstallPanel.tsx` shows what installing a type blueprint would write, one checkbox per field, and it reads its own footer from `planBlueprintInstall` rather than counting on its own.

## Hover peek

A rest on a rendered entity names it (ADR-0055). `apps/canvas/src/canvas/peek/peekResolver.ts` answers for one `Target` at a time (a card, a board, a section or a link) and returns `null` for a kind it cannot describe, so the surface opens nothing rather than guessing. A card reads the same way in the outline rail, on a rollup row and on a link endpoint because all three ask the same resolver.

`usePeek` in `canvas/peek/usePeek.ts` holds the timing rules, which are the whole difficulty:

| Rule | Value | Why |
| --- | --- | --- |
| Open after a rest | `openAfterMs` 450 | Long enough to separate a passing pointer from a rest |
| Grace after leaving | `closeAfterMs` 120 | Lets the pointer cross the gap into the peek |
| A focus this soon after a press came from it | `pointerFocusGraceMs` 250 | A click selects; it does not peek |

Escape, a pointer press anywhere, a scroll and a zoom all dismiss, and those listeners live in the hook rather than in each surface, so no surface can forget one. Keyboard access is the same resolve: `focus` opens the peek at once, with no delay, and `PeekSurface` renders in place rather than through a portal so Tab from the trigger reaches its one button. The surface never takes focus itself, and it is a reading: a name, a kind, one line of context and a route to open the thing. Editing stays in the inspector.

The outline rail is the first surface wired to it: `BoardOutline.tsx` gives each section row a `peek` controller, and the rail renders one `PeekSurface` for all of its rows.

## Error codes

`apps/canvas/src/i18n/` ships codes before sentences. `codes.ts` is a closed union of `domain.subject.reason` strings, `messages.en.ts` is the English catalogue typed as `Record<ErrorCode, string>` so a code without a message fails the typecheck, and `messageFor` turns a code into a sentence with `{name}` placeholders filled.

An unknown code is returned as itself, which keeps a log line greppable and leaves the interface short rather than blank. There is one locale and no plural or number formatting yet; a second catalogue is a new file and one entry in `catalogues`, because nothing outside the catalogue holds a sentence.


## Selection

Selection is UI state with several readers: the canvas paints it, the inspector opens on it, and the commands that act on "this" resolve against it. `selectedNodeIds`, `selectedEdgeIds`, `selectedSectionId` and `containerInspector` in `useUiStore` are the whole of it.

A modifier click belongs to multi-select and must not open the inspector; the card's click handler returns early for shift, meta and ctrl, and the drag handler decides ownership on pointer down so pan and drag never both claim the same gesture.

While a link is being drawn, the inspector fades. The preview passes under the panel and the destination is usually the thing the panel covers, so `linkingInProgress` exists for that one layout decision and nothing about the draft is written to the document.

## Presence surfaces

Presence is drawn above the board and below the chrome. `PresenceCursor` shows a peer's pointer with their name, in flow coordinates so it stays on the right card at every zoom. `PeerNameTag` labels the thing a peer is manipulating and picks its own ink, because a presence colour is chosen by a person and a chip cannot assume white text clears the floor. `PresenceAvatars` stacks the people on a card and collapses the overflow.

`StatusCursor` in `apps/canvas/src/cursor/StatusCursor.tsx` is the single renderer for a pointer, and it says what the next click will do. The ring's shape and glyph carry the purpose, its colour comes from the reader's presence colour, and the bubble names both. It never relies on hue alone.

Marquee and drag boxes ride the same ephemeral channels as the pointer. They are `pointer-events: none` and never wrote a position; the document write happens on release.

## Dialogs and menus

Every overlay portals into `document.body`. A `position: fixed` menu rendered inside the canvas would be positioned against that transformed ancestor instead of the window, which puts it off screen; portalling is the reason a menu opens where the pointer is.

`ContextMenu` clamps itself to the viewport and flips a submenu to the left of its parent when the menu was opened near the right edge. A submenu opens on hover, on focus and on click, and a click never toggles it shut, because the pointer already opened it. It also takes focus on its first item when it opens, for the reason in [Focus and keyboard](#focus-and-keyboard).

`Dialog` is the confirmation shell: a title, optional description, and a list of actions marked primary or danger. The scrim is a labelled button, so a pointer press outside the panel is a dismissal a screen reader can also reach.

Every dialog that says `aria-modal="true"` traps Tab. `SignInDialog`, `AdmissionPanel`, `ShareDialog`, the publish conflict dialog in `SharePublishButton.tsx`, `SettingsDialog` and the shortcut sheet all call `useFocusTrap`, and `AdmissionPanel` starts on the answer it recommends ("Keep working locally") and closes on Escape. Card focus mode is a modal for the board rather than for the window: `CardFocusSurface` carries `role="dialog"` and the same trap, and a sketch's drawing surface takes the initial focus, because a sketch listens for keys and had none of them before.

Three questions that used `window.confirm` ask in the surface that owns them. Deleting a trashed card for good opens the library's `Dialog` through `pendingPurge`. Revoking every share link and reloading a draft both replace the control with an inline confirmation inside the dialog they belong to, so the thing about to be lost stays on screen.

Two confirmations ask for more than a press. `DeleteWorkspaceDialog` requires the workspace name or id to be typed and reports a failure inline without touching the local copy. `LeavingDialog` offers a backup export before the reader leaves a workspace that exists only in this browser.

`DisplayStyleDialog` edits one display template with preset buttons, a live preview through `ValueTemplate`, and a scope choice between this instance and the field.

## Styles and appearance

Workspace style is document data. `apps/canvas/src/styles/StylesDialog.tsx` lists style rules, ordered by rung, and `StyleTab` edits one surface or one rule. Rules are stored in the document, resolved through `resolveSurfaceStyle`, and painted as variables, so a collaborator sees the same colours (ADR-0071). A rule that does not exist yet is created on its first edit, never on selection.

Device appearance is local, and it lives in Settings. `apps/canvas/src/styles/SettingsDialog.tsx` is a modal dialog with a focus trap, Escape through the escape stack, and one section for now: `AppearanceSection` sets density, card radius, canvas background and a motion preference, written by `apps/canvas/src/theme/appearance.ts` as attributes on `<html>` (`data-density`, `data-canvas`, `data-motion`) plus a `--reader-card-radius` variable. Nothing about it is synced, because it changes how this screen draws and never what a peer sees.

The dialog opens from the theme menu (`theme-appearance`, which reads "Settings…") and from the palette's `system.settings` row. Both go through `openSettings` in `apps/canvas/src/styles/settingsEvents.ts`, a window event, so neither surface has to own the other's state. The appearance controls keep their `appearance-*` test ids.

Theme mode is separate again: `apps/canvas/src/theme/theme.ts` resolves `light`, `dark` or `system` and toggles the `dark` class plus `data-theme` on the root, so both the class-based and attribute-based CSS see one decision.

## Theme tokens

`apps/canvas/src/styles/global.css` defines the token set for both themes at the top of the file.

| Token | Role |
| --- | --- |
| `--surface`, `--surface-strong`, `--surface-translucent` | Panel and card backgrounds |
| `--hairline` | Every border, at 8 percent ink in light and 10 percent in dark |
| `--ink`, `--ink-muted` | Body and secondary text |
| `--canvas-bg`, `--rf-dot` | Canvas ground and dot grid |
| `--accent`, `--accent-strong`, `--danger`, `--success`, `--warning` | Named roles, never a raw hue at a call site |
| `--value-*-hue`, `--value-*-fill`, `--value-*-ink` | The eight value roles of the mode and purpose controls |

Muted text carries a measured floor: `--ink-muted` is `#68686d` in light, which is 4.57:1 on the darkest muted surface it appears on, and `#a8a8ad` in dark, which is 5.29:1 on a hovered surface. The value palette deepens a Section hue when it is used as a chip fill, because `--section-blue` at 3.68:1 was never asked to carry text. A card whose paint the resolver had to correct reports `data-contrast-corrected="true"` instead of drawing an illegible pair (ADR-0046).

## Density and canvas treatment

The reader's density setting changes one rule: `[data-density="compact"] .node-card__body` reduces the body padding so more cards fit on one screen. The canvas treatment setting hides the dot grid with `[data-canvas="plain"] .react-flow__background` and moves nothing else. Card radius is a single variable, `--reader-card-radius`, and a card's own stored radius still wins.

`BootSkeleton` covers the wait while IndexedDB is read. It is a `status` region with `aria-busy` and a labelled progress bar, and it deliberately mounts neither the canvas nor any editor.

## The command palette

`apps/canvas/src/command/commandRegistry.ts` describes every user-invokable action once: id, group (`navigation`, `create`, `edit`, `layout`, `view`, `system`), the surface that lists it (`palette`, `library`, `inspector`, `canvas`), the capabilities it needs and a predicate over the current state.

`paletteProviders.ts` projects those definitions into rows, `paletteRank.ts` ranks them, and the palette draws the first 40. The palette holds only its query and its highlighted row, so closing it leaves nothing behind.

Keys: typing filters, `ArrowDown` and `ArrowUp` move the highlight, `Enter` runs the row after closing, `Escape` closes. The search input is a `combobox` with `aria-activedescendant` pointing at the highlighted `option`, so a screen reader announces the row that Enter would run. A command that declares a `shortcut` prints it in a column at the row's right edge, from the same field the shortcut sheet reads.

The library, the inspector and the canvas context menu read the same registry. Availability is a property of the command, which is why a read-only session loses a command everywhere at once rather than in the surfaces someone remembered to guard.

`help.shortcuts` opens the shortcut sheet and `system.settings` opens Settings, both through the window events their hosts listen for. `edit.undo` and `edit.redo` are listed only while `CommandActions` holds a handler. The shell supplies both from `apps/canvas/src/app/useBoardPaletteActions.ts`, which steps the document's undo manager and clears the selection afterwards, exactly as the dock's pair of buttons does.

Three commands act on the document rather than on a surface, and each is listed only while its `CommandActions` field is supplied, so the palette and the dock never offer a row that cannot run. `layout.arrangeRadial` runs the shell's arrangement, which reads the selection in paint order and hands `planRadial` and `childrenFromLinks` (the same pure functions `arrangeRadialSelection` in `apps/canvas/src/canvas/board/useBoardCommands.ts` uses for the board's own menu) to `applyLayoutPlan`. `type.installBlueprint` opens `apps/canvas/src/app/BlueprintInstallHost.tsx` on the card the row names: the palette previews the type the card declares and installs it on one press through `installBlueprintCard`, the same call `installBlueprintSelection` makes. It needs `canManageSchema`, which the registry reads from the same capability matrix as every other write.

## Focus and keyboard

Escape is a stack. `apps/canvas/src/shell/escapeLayers.ts` keeps one layer per open surface, the most recent wins, and the key is claimed in the capture phase so the canvas chain never also acts on it. A text field inside a non-modal surface keeps Escape for itself; a field inside a dialog does not, because a dialog is what Escape is for.

A modal panel traps Tab. `useFocusTrap` in `apps/canvas/src/dialogs/useFocusTrap.ts` moves focus in, wraps Tab and Shift-Tab inside the panel, and returns focus to whatever opened it. It exists because `aria-modal="true"` says the page behind is inert, and before it the last Tab walked into the canvas behind the scrim.

Menus answer the arrows. Every `role="menu"` container handles `ArrowUp`, `ArrowDown`, `Home` and `End` through `menuKeyDown` in `apps/canvas/src/dialogs/menuKeys.ts`, moving focus among its own items and skipping a nested submenu's rows. Without it the role announced behaviour the keys did not have.

A menu also takes focus when it opens. `focusFirstMenuItem` is the menu's `ref`, so the first item holds focus on the frame the menu appears, which is what lets the key handler run at all; before it, focus stayed on the trigger and `ContextMenu`, portalled to `body`, sent Tab to the end of the document. The same ref restores focus to the opener when the menu unmounts, unless something else already took it.

A combobox is not a menu. `apps/canvas/src/cards/CardPicker.tsx` keeps focus in its search field and names the highlighted row with `aria-activedescendant`, because focus moving into the list would end the query after the first keystroke. `focusFirstMenuItem` looks for `menuitem` rows, so it is not the helper that surface needs; `Home` and `End` stay caret keys there for the same reason.

A tablist is one tab stop. `tabKeyDown` in `apps/canvas/src/dialogs/tabKeys.ts` handles `ArrowRight`, `ArrowLeft`, `Home` and `End`, and selection follows focus; `LibraryHeader` and `ContainerPanel` use it, and `CardPanelTabs` follows the same pattern.

The shortcut sheet is the reference for every key. `apps/canvas/src/command/shortcutSheet.ts` builds its rows from the registry's `shortcut` fields and adds the board keys the registry does not own (`[` for the outline, Enter, Delete, Shift+Delete, Escape). `ShortcutSheetHost` opens it on the `suite:shortcuts-open` event or on `?` outside a text field, and the dock's `?` button is the visible trigger.

Undo and redo are a pair of buttons in the dock (`apps/canvas/src/chrome/UndoRedo.tsx`). They read the document's own `canUndo` and `canRedo`, subscribe through `useWorkspaceSnapshot`, and clear the selection after a step, because the card that just went away must not stay selected.

Reveals are a request, not a scroll. A surface that wants a card or a section shown writes `focusTarget` (`focusCard`, `focusSection`), and the canvas consumes it once. No panel calls `setCenter` or `fitBounds`.

Global shortcuts: `Mod+K` opens the palette, `Mod+Shift+K` opens the library on its cards tab and focuses the search box, `Mod+Enter` creates a card at the centre of the viewport, `Mod+G` creates a section around the selection, `Mod+Z` and `Mod+Shift+Z` undo and redo structure, `[` toggles the outline, and `?` opens the shortcut sheet. `Enter` opens the selected node from the canvas keyboard chain, and a title commits on `Enter` rather than adding a line.

## Accessibility

Dialogs and the palette carry `role="dialog"` with `aria-modal="true"` and a label, and every one of them traps Tab. The library drawer is a labelled dialog without `aria-modal`, because it docks beside the canvas and the canvas stays usable.

Focus is drawn one way. `--accent` is the ring colour for every `:focus-visible` rule in `apps/canvas/src/styles/`, at 2px with a 1px offset. The app bar, the board tabs, the dock buttons, the library tabs and the library rows had no rule of their own and fell back to the browser's ring while the rest of the app used three different colours.

State is never colour alone. The status cursor carries a glyph per purpose and names its owner and purpose in a label; sync status pairs a coloured dot with a word; the value controls use shapes and glyphs as well as the role hues.

Motion is a preference before it is a style. `prefers-reduced-motion` removes the launcher slide, the peer cursor and name-tag entrances, the portal scrim and its own transitions, the tour spotlight travel and the live drag transitions. The reader's `data-motion="reduced"` attribute does the same for every element, including transitions a component declared for itself.

Focus is always visible on interactive elements, and a focusable read-only control is avoided: a card title opens on double-click, and the same button also answers `Enter` and `Space`, so the gesture has a keyboard path.

## Tests

| Behaviour | Test |
| --- | --- |
| Focus trap and focus restore | `apps/canvas/src/dialogs/useFocusTrap.test.tsx` |
| Menu arrow keys, and focus entering the menu | `apps/canvas/src/dialogs/menuKeys.test.tsx` |
| Tab strip keyboard | `apps/canvas/src/dialogs/tabKeys.test.tsx` |
| Each menu takes focus on open | `ContextMenu.test.tsx`, `Dock.test.tsx`, `ViewsBar.test.tsx`, `BoardTabs.test.tsx`, `WorkspaceActions.test.tsx`, `ThemeToggle.test.tsx`, `CardTypePicker.test.tsx` and `SignInEntry.test.tsx` beside each component |
| A combobox keeps focus in its field | `apps/canvas/src/cards/CardPicker.test.tsx` |
| Each modal dialog traps Tab | `SignInDialog.test.tsx` and `AdmissionPanel.test.tsx` in `apps/canvas/src/auth/`, `ShareDialog.trap.test.tsx` and `ConflictDialog.test.tsx` in `apps/canvas/src/sharing/`, `SettingsDialog.test.tsx` |
| Card focus mode as a dialog | `apps/canvas/src/cards/CardFocusSurface.test.tsx` |
| Library rows by keyboard, sort and truncation | `apps/canvas/src/library/LibraryDrawer.test.tsx` |
| Shortcut rows and the sheet | `apps/canvas/src/command/ShortcutSheet.test.tsx` |
| Undo and redo buttons | `apps/canvas/src/chrome/UndoRedo.test.tsx` |
| One focus ring token | `apps/canvas/src/styles/focusRing.test.ts` |
| Questions that replaced the platform confirm | `useLibraryRowActions.test.ts` and `LibraryDrawer.test.tsx` in `apps/canvas/src/library/`, `ShareDialog.test.tsx` and `ConflictDialog.test.tsx` in `apps/canvas/src/sharing/` |
| Palette ranking and rows | `apps/canvas/src/command/CommandPalette.test.tsx` |
| Command availability | `apps/canvas/src/command/commandRegistry.test.ts` |
| Tab strip keyboard | `apps/canvas/src/cards/CardPanel.test.tsx` |
| Library filters and selection | `apps/canvas/src/library/*.test.ts` |
| Theme and appearance resolution | `apps/canvas/src/theme/*.test.ts` |
| Escape layer order | `apps/canvas/src/shell/escapeLayers.test.ts` |
| Hover-peek timing and dismissal | `apps/canvas/src/canvas/peek/usePeek.test.ts` |
| Peek resolution per entity kind | `apps/canvas/src/canvas/peek/peekResolver.test.ts` |
| Outline peek wiring | `apps/canvas/src/canvas/peek/outlinePeek.test.tsx` |
| Annotation range states | `apps/canvas/src/canvas/annotations/annotationRecord.test.ts` |
| Blueprint install diff and partial install | `apps/canvas/src/canvas/blueprints/blueprint.test.ts` |
| Error codes and the catalogue | `apps/canvas/src/i18n/i18n.test.ts` |

Storybook covers the components whose look is the behaviour: `*.stories.tsx` beside each component in `apps/canvas/src/chrome/`, `apps/canvas/src/library/`, `apps/canvas/src/presence/` and `apps/canvas/src/dialogs/`.

The surfaces that mount without a live document have a story: `WorkspaceLauncher.stories.tsx` (empty state, because the recents come from this browser), `CommandPalette.stories.tsx` (static rows, including the shortcut column), `ShortcutSheet.stories.tsx`, `SettingsDialog.stories.tsx`, `ConflictDialog.stories.tsx` in `apps/canvas/src/sharing/`, and `ContainerPanel.stories.tsx` in `apps/canvas/src/panels/` with a plain document fixture.

Three surfaces cannot be mounted that way, so the story suite cannot catch a regression in them: the canvas (`apps/canvas/src/canvas/**`) needs the projection, the camera and a real `LoroDoc` fed by the provider; the shell (`apps/canvas/src/app/WorkspaceShellView.tsx`) needs the same document plus a live session; and the share dialogs that call the relay need a `/api/shares` answer, which is why only the pure `ConflictDialog` has a story.
