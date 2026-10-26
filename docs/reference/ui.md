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
| Inspector | `apps/canvas/src/cards/CardInspectorHost.tsx` | The one panel for the selected card or container |
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

`libraryFull` widens the drawer to the whole window for browsing; the floating width stays the default because a row has to be draggable onto the canvas beside it. `LibrarySelectionBar` appears with the selection mode, not with the first row, and offers placing the selection as a run.

## Board navigation

Board tabs are a navigation, not a tab strip. Switching a board replaces the canvas, so the active tab carries `aria-current="page"`, and the strip can hold the close button and the inline rename field it needs without breaking required children. A back control appears when the visit history has somewhere to go; the history records the board and the viewport, so returning restores both.

The home board is a tab that is always reachable when it is not the active one. A portal's entry and the library's "go to board" both go through the same activation path, which is why the back stack exists for every route into another board.

Peers show on tabs as small avatars, aggregated per board, so "where is everyone" is answerable without opening the outline.

## Panels

One inspector exists. `CardPanel` renders in two variants, `inspector` (docked beside the canvas) and `embedded` (inside a card focus), and both read the same card model, so a property can be fixed without going to the canvas (ADR-0050).

Its tab strip has Details, Content and Style. Details carries the type and tag pickers, the properties, the placement and the links; Content is the body editor, or the step list for a tutorial; Style is the per-card style surface. The strip behaves as one tab stop with arrow-key movement, and the selected tab is the only one with `tabIndex=0`.

`ContainerPanel` covers the container selection (section or portal), `LinkInspector` covers one edge, and `ExplainPanel` shows the explain context. `TypeSettingsDialog` edits the type registry and its fields. Each of these writes through `@suite/graph`; none keeps a copy of the record it edits.

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

`ContextMenu` clamps itself to the viewport and flips a submenu to the left of its parent when the menu was opened near the right edge. A submenu opens on hover, on focus and on click, and a click never toggles it shut, because the pointer already opened it.

`Dialog` is the confirmation shell: a title, optional description, and a list of actions marked primary or danger. The scrim is a labelled button, so a pointer press outside the panel is a dismissal a screen reader can also reach.

Two confirmations ask for more than a press. `DeleteWorkspaceDialog` requires the workspace name or id to be typed and reports a failure inline without touching the local copy. `LeavingDialog` offers a backup export before the reader leaves a workspace that exists only in this browser.

`DisplayStyleDialog` edits one display template with preset buttons, a live preview through `ValueTemplate`, and a scope choice between this instance and the field.

## Styles and appearance

Workspace style is document data. `apps/canvas/src/styles/StylesDialog.tsx` lists style rules, ordered by rung, and `StyleTab` edits one surface or one rule. Rules are stored in the document, resolved through `resolveSurfaceStyle`, and painted as variables, so a collaborator sees the same colours (ADR-0071). A rule that does not exist yet is created on its first edit, never on selection.

Device appearance is local. `apps/canvas/src/styles/AppearanceDialog.tsx` sets density, card radius, canvas background and a motion preference, written by `apps/canvas/src/theme/appearance.ts` as attributes on `<html>` (`data-density`, `data-canvas`, `data-motion`) plus a `--reader-card-radius` variable. Nothing about it is synced, because it changes how this screen draws and never what a peer sees.

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

Keys: typing filters, `ArrowDown` and `ArrowUp` move the highlight, `Enter` runs the row after closing, `Escape` closes. The search input is a `combobox` with `aria-activedescendant` pointing at the highlighted `option`, so a screen reader announces the row that Enter would run.

The library, the inspector and the canvas context menu read the same registry. Availability is a property of the command, which is why a read-only session loses a command everywhere at once rather than in the surfaces someone remembered to guard.

## Focus and keyboard

Escape is a stack. `apps/canvas/src/shell/escapeLayers.ts` keeps one layer per open surface, the most recent wins, and the key is claimed in the capture phase so the canvas chain never also acts on it. A text field inside a non-modal surface keeps Escape for itself; a field inside a dialog does not, because a dialog is what Escape is for.

A modal panel traps Tab. `useFocusTrap` in `apps/canvas/src/dialogs/useFocusTrap.ts` moves focus in, wraps Tab and Shift-Tab inside the panel, and returns focus to whatever opened it. It exists because `aria-modal="true"` says the page behind is inert, and before it the last Tab walked into the canvas behind the scrim.

Menus answer the arrows. Every `role="menu"` container handles `ArrowUp`, `ArrowDown`, `Home` and `End` through `menuKeyDown` in `apps/canvas/src/dialogs/menuKeys.ts`, moving focus among its own items and skipping a nested submenu's rows. Without it the role announced behaviour the keys did not have.

Reveals are a request, not a scroll. A surface that wants a card or a section shown writes `focusTarget` (`focusCard`, `focusSection`), and the canvas consumes it once. No panel calls `setCenter` or `fitBounds`.

Global shortcuts: `Mod+K` opens the palette, `Mod+Shift+K` opens the library on its cards tab and focuses the search box, `Enter` opens the selected node from the canvas keyboard chain, and the title commits on `Enter` rather than adding a line.

## Accessibility

Dialogs and the palette carry `role="dialog"` with `aria-modal="true"` and a label. The library drawer is a labelled dialog without `aria-modal`, because it docks beside the canvas and the canvas stays usable.

State is never colour alone. The status cursor carries a glyph per purpose and names its owner and purpose in a label; sync status pairs a coloured dot with a word; the value controls use shapes and glyphs as well as the role hues.

Motion is a preference before it is a style. `prefers-reduced-motion` removes the launcher slide, the peer cursor and name-tag entrances, the portal scrim and its own transitions, the tour spotlight travel and the live drag transitions. The reader's `data-motion="reduced"` attribute does the same for every element, including transitions a component declared for itself.

Focus is always visible on interactive elements, and a focusable read-only control is avoided: a card title opens on double-click, and the same button also answers `Enter` and `Space`, so the gesture has a keyboard path.

## Tests

| Behaviour | Test |
| --- | --- |
| Focus trap and focus restore | `apps/canvas/src/dialogs/useFocusTrap.test.tsx` |
| Menu arrow keys | `apps/canvas/src/dialogs/menuKeys.test.tsx` |
| Palette ranking and rows | `apps/canvas/src/command/CommandPalette.test.tsx` |
| Command availability | `apps/canvas/src/command/commandRegistry.test.ts` |
| Tab strip keyboard | `apps/canvas/src/cards/CardPanel.test.tsx` |
| Library filters and selection | `apps/canvas/src/library/*.test.ts` |
| Theme and appearance resolution | `apps/canvas/src/theme/*.test.ts` |
| Escape layer order | `apps/canvas/src/shell/escapeLayers.test.ts` |

Storybook covers the components whose look is the behaviour: `*.stories.tsx` beside each component in `apps/canvas/src/chrome/`, `apps/canvas/src/library/`, `apps/canvas/src/presence/` and `apps/canvas/src/dialogs/`.
