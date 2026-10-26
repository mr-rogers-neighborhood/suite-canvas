# Change the editor

Add a node, a mark, a field renderer, a slash command or a mention action to the card editor, with the files each one touches and the tests that fail when it is half done.

The editor is Tiptap over ProseMirror, bound to Loro per container. Two rules shape every change below: the schema is declared once in `apps/canvas/src/editor/cardEditorExtensions.ts` so the publish allowlist can be checked against it, and the publish allowlist in `packages/graph/src/publish/validation/richTextSchema.ts` is the contract a shared body is validated against.

## Add a node

1. Create the node in `apps/canvas/src/editor/`. A node with a React view needs a `Node.create` with `addAttributes`, `parseHTML` and `renderHTML`, plus a `ReactNodeViewRenderer` pointing at the view component. `apps/canvas/src/editor/imageLinkNode.tsx` is the smallest complete example; `apps/canvas/src/editor/attachmentNode.ts` shows one whose bytes live elsewhere.
2. Store ids and sizes in attributes, never content. A node that holds a document id reads its target live, which is what keeps a rename or a delete from being copied into every body.
3. Add the node to `cardBodySchemaExtensions` in `apps/canvas/src/editor/cardEditorExtensions.ts`. The title editor builds its own shorter list inside `CardTitleEditor` in `apps/canvas/src/cards/CardBodyEditor.tsx`, which is `StarterKit` plus `Mention`; a node the title should hold has to be added there too.
4. Add the node name to `RICH_TEXT_NODE_NAMES` and its attributes to `RICH_TEXT_NODE_ATTRIBUTE_NAMES` in `packages/graph/src/publish/validation/richTextSchema.ts`. This is the step people forget: `apps/canvas/src/editor/editorSchemaContract.test.ts` compares the two lists against the real schema, so a node missing from the allowlist fails there rather than in a share.
5. Write a test beside the node. Build an `Editor` with `StarterKit` and the node alone, then assert serialisation, attribute round-trip and the view. `apps/canvas/src/editor/imageLinkNode.test.tsx` and `apps/canvas/src/editor/attachmentNode.test.tsx` are the two shapes to copy.

A node that reads the workspace needs the id it reads from. `TourStep.configure({ cardId })` is the pattern: the extension takes the owning card as an option, and the node view reads the store rather than receiving a copy through props.

## Add a mark

1. Define the mark in `apps/canvas/src/editor/`, or take it from `StarterKit` if Tiptap already ships it. The body currently accepts `bold`, `italic`, `strike`, `code`, `link` and `underline`.
2. Register it in `cardBodySchemaExtensions`.
3. Add the mark name to `RICH_TEXT_MARK_NAMES` in `packages/graph/src/publish/validation/richTextSchema.ts`.
4. Add a control to the `BubbleMenu` in `apps/canvas/src/cards/CardBodyEditor.tsx`, and add its pressed state to the `useEditorState` selector beside the existing ones. The selector is what keeps a keystroke from re-rendering the whole editor.
5. Extend `editorSchemaContract.test.ts` if the mark adds attributes, and add a case to the export tests if the mark changes serialised output.

A mark does not need a Loro change: the CRDT stores the ProseMirror tree, so a new mark is a schema change only.

## Add a field renderer

A built-in field kind is rendered by the switch in `FieldValueInput` in `apps/canvas/src/cards/PropertyField.tsx`. A kind that needs more than a native control registers an editor instead, which is how `rating`, `group` and `list` ship without touching the switch.

1. If the kind is new to the schema, add it to `fieldKinds` in `packages/graph/src/schema.ts`, extend `readPropertyValue` in `packages/graph/src/property.ts` so it has a textual reading, and add the parse and reject cases to `packages/graph/src/schema.test.ts`. That work is described in [add-a-feature.md](add-a-feature.md).
2. Write the editor component in `apps/canvas/src/field/`. It receives `FieldEditorProps` from `apps/canvas/src/field/fieldKindRegistry.tsx`: the field, the value, `onCommit` (with `null` meaning clear), `autoFocus`, `onDone` and `onCancel`.
3. Register it with `registerFieldKind({ kind, editor })` at module scope. `apps/canvas/src/field/compositeKinds.tsx` is the example, and `apps/canvas/src/cards/PropertyField.tsx` imports it so the registration happens before any control renders; a new module needs an import from a component that is always mounted, or the kind registers nowhere.
4. Do not add a formatter. Read-only surfaces format through `formatPropertyValue` in `packages/graph/src/property.ts`; the registry has no `format` field on purpose, because two formatters for one value drifted once already.
5. Test the editor with React Testing Library: commit on change, commit `null` when cleared, and the `aria-label` a screen reader hears. `apps/canvas/src/field/compositeKinds.test.tsx` covers the three composing kinds.

If the control is shared by the inspector and an inline block, keep the parse rules in `PropertyField.tsx` so both surfaces commit the same value.

## Add a command

1. Add the row to `apps/canvas/src/command/commandRegistry.ts`: id, group, the surfaces that list it, the capabilities it requires and the state predicate that decides whether it is available. Availability is one rule for every surface, so a read-only session loses the command everywhere at once.
2. Add the handler to the context type beside it. A command calls exactly one handler, and a surface adopts the command by supplying the handler it already owns.
3. If the row needs a target list (boards, cards, views, sections, types), extend `CommandContext` and the provider in `apps/canvas/src/command/paletteProviders.ts` rather than filtering in the palette component.
4. Update `apps/canvas/src/command/commandRegistry.test.ts`, which checks availability table-wise. A command with no test row is a command nobody has proved.
5. If the command should also appear in the `/` menu, add it to `SLASH_ITEMS` in `apps/canvas/src/editor/SlashCommands.ts` instead: those rows run against the editor and consume the typed query first.

A palette row shows a title and an optional subtitle. Keep the title the verb, and put the target in the subtitle.

## Add a slash command

1. Append to `SLASH_ITEMS` in `apps/canvas/src/editor/SlashCommands.ts`: `id`, `title`, the `hint` line, a `glyph`, `keywords`, and `run(editor, range)`. Start `run` with `consumeQuery(editor, range)` so the typed `/query` never becomes text.
2. Add keywords for the names people actually type; the query matches them as well as the title.
3. Cover it in `apps/canvas/src/editor/SlashCommands.test.ts`: the row exists, and running it produces the expected document.
4. If the row needs input from the reader, insert a widget rather than opening a dialog. `ImageUrlPrompt` is the example: the caret and the editing session survive the answer.

## Add a mention action

A mention row is not a slash row. Rows come from `apps/canvas/src/editor/SuggestionList.tsx`, and the three kinds are fixed by what the chip can store: a card, a field of the current card (a property block), and a field of another card (a `@card.field` chip).

1. Extend the row builder in `SuggestionList.tsx` and keep `MentionSuggestionItem.kind` accurate; the insert path branches on it.
2. If the row inserts a node, add that node to the body schema and the publish allowlist as described above.
3. Keep the picker's keyboard contract: `ArrowDown` and `ArrowUp` move, `ArrowRight` or `.` enters a card's fields, `ArrowLeft` leaves them, `Enter` inserts, `Escape` closes. `apps/canvas/src/editor/Mention.test.ts` and `apps/canvas/src/editor/SuggestionList.test.ts` cover the picker; `apps/canvas/src/editor/MentionChip.test.tsx` covers what the chip renders.

## Verify

```sh
pnpm exec vitest run apps/canvas/src/editor apps/canvas/src/cards apps/canvas/src/field
pnpm --filter @suite/canvas typecheck
pnpm exec vitest run packages/graph/src
pnpm e2e:smoke
```

Storybook is worth a look when the change is visible: `pnpm storybook`, then the `Components/` group. A new node that renders an image, a chip or a block belongs there.

A schema change also needs the publish allowlist, the export tests and the share projection reviewed, because all three read the same node list. If the change alters what a shared body may contain, update `packages/graph/src/publish/validation/richTextSchema.ts` in the same commit.
