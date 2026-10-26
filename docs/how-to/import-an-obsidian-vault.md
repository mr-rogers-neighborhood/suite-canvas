# Import an Obsidian vault

Dropping a vault folder into Suite reads every note, tag, link and canvas into one workspace. The import
runs once, as a single change, so `undo` takes it back whole.

## Read the vault

`collectVaultFiles` in `packages/import-obsidian/src/drop.ts` walks the entries a drop hands over and returns
the shape the importer takes: paths relative to the dropped folder, with text for notes and canvases. Its
entry types are structural, so a browser `FileSystemEntry` satisfies them without a cast.

```ts
const entries = Array.from(dataTransfer.items, (item) => item.webkitGetAsEntry());
const { files, skipped } = await collectVaultFiles(entries);
```

## Import it

```ts
import { importObsidianVault } from "@suite/import-obsidian";

const result = importObsidianVault(workspace, {
  files: collected.files,
  homeBoardName: "My vault",
});
if (result.isErr()) return result.error.message;
return reportSummary(result.value);
```

`importObsidianVault` writes through `@suite/graph`'s typed methods inside one batch. The workspace must
already carry the field definitions a key should fill; a key with no matching field is kept as body text
rather than dropped.

## The launcher action

The launcher owns the button, so this package exposes the functions rather than the UI. The launcher needs a
third input beside `.suite` and `.json`:

- A file input with no `accept` filter cannot take a folder. Use a drop target over the launcher header and
  call `collectVaultFiles` with the dropped entries.
- Pass `homeBoardName` from the dropped folder's name, so the vault root's board reads as the vault.
- Create the target workspace first, then call `importObsidianVault` with its `WorkspaceDocument`, the same way
  `openRecoveryKey` opens one. The import writes to an existing document; it does not create one.

## The mapping

The table is data in `packages/import-obsidian/src/mapping.ts`, so a change to what the importer carries is a
change to one array, and the fixture vault's test walks it.

| Source | Target | What travels |
| --- | --- | --- |
| Vault root | Home board | The workspace's first board holds every note outside a folder. Its name is the vault folder's name when the caller passes one. |
| Folder | Board | One board per folder that holds at least one note, named by the folder's whole path (`Projects / Notes`), so a nested hierarchy stays visible. A canvas file is a board of its own, so a folder of canvases needs no board. Boards have no parent, so the path is the hierarchy. |
| Markdown note (`.md`) | Card | One card per note, placed on its folder's board in a grid, because a note has no geometry of its own. |
| First `#` heading | Card title | Used when the heading opens the note; that block leaves the body. A note without one is titled by its file name. |
| Note body | Card body | Headings, paragraphs, block quotes, bullet and ordered lists (nested by indentation), fenced code with its language, and horizontal rules. Tables, HTML, footnotes and diagrams stay as the text they were written as. |
| Frontmatter key matching a field name | Card property | Matched case-insensitively against the workspace's field definitions and coerced by the field's kind: a select by option label, multi-select by label list, checkbox by truthiness, number by value. `fieldByKey` overrides the match with a field id. |
| Frontmatter key with no field | Body paragraph, plus a report row | Written as `key: value` at the end of the body under a `Properties` heading, and listed in `properties.keptAsText`. Every kept key appears in the report. |
| Frontmatter that is not valid YAML | Body text, plus a report row | The block is kept where it was, the note still imports, and the reason is reported. |
| `tags:` / `tag:` in frontmatter | Card tags | Every spelling Obsidian accepts: a comma string, a YAML list, or both keys. Names are normalised by `ensureTag`, which trims and matches case-insensitively. |
| Inline `#tag` | Card tag | The tag token leaves the body text and becomes a tag on the card. A `#` inside code is text, and a purely numeric tag is text, because Obsidian does not treat it as a tag either. |
| `[[Note]]` | Mention in the body, indexed by the reference index | Resolved against the vault by file name (then by path, then by the note's own folder). A resolved link becomes a mention node, so backlinks come from the existing index rather than a second edge record. An unresolved target stays as the text `[[Note]]` and is counted in the report. |
| `[[Note|alias]]`, `[[Note#heading]]` | Mention plus text | The alias or the heading is kept as text after the mention, so the sentence still reads. |
| External link | Link mark | A Markdown link whose address is `http`, `https` or `mailto` becomes a link mark on its label. Any other scheme keeps the label as text, drops the address, and is reported. |
| `![[image.png]]` | Text, plus a report row | Attachment bytes are not imported: the mention becomes the file's name as text and the path is listed under `attachments`. |
| `.canvas` file | Board | Named after the file, with one placement per node at its real geometry. |
| Canvas `text` node | Card | The node's first line becomes the title and the Markdown under it becomes the body, so nothing is duplicated on the card. Its `x`/`y`/`width`/`height` become the placement, and its colour becomes the card's surface role. |
| Canvas `file` node | The imported card for that file | A file node whose target is not in the vault becomes a card titled by the file name, with the path as its body text. |
| Canvas `link` node | Card | Titled by the address, which is also the card's body, so the URL is never lost. |
| Canvas `group` node | Section | Geometry and label carry over. A group whose label is empty gets a section titled `Group`. |
| Canvas edge | Link between the two cards | The edge's `label` becomes the link's label. A side hint (`fromSide`/`toSide`) is not stored: the link uses the default connector layout, and the report says so. |
| Canvas node colour | Section colour or card surface role | Obsidian's six presets map to the palette the schema names. A hex colour has no slot: the styles name roles rather than values, so it is reported instead of approximated. |
| `.obsidian/` and unknown extensions | Skipped, with a reason | Settings and files the importer cannot read appear in `skipped`; nothing is ignored silently. |

## The fidelity summary

`importObsidianVault` returns a `Result<ImportReport, ImportFailure>`. The success value is what the caller
shows after the import:

| Field | What it says |
| --- | --- |
| `files` | How many files were read as notes, canvases and attachments, and how many were skipped |
| `records` | Boards, cards, sections, tags and links written |
| `links.resolved`, `links.unresolved`, `links.ambiguous` | Wikilinks that became mentions, targets the vault does not have, and names two notes share |
| `properties.mapped`, `properties.keptAsText` | Frontmatter keys that filled a field, and keys kept as text with the note they belong to |
| `colours.sections`, `colours.cards`, `colours.unmapped` | Canvas colours that found a slot, and hex values that did not |
| `attachments` | Embedded files kept as text, with the reason |
| `skipped` | Files not read, with the reason |
| `notes` | One sentence per class of loss, such as an edge side that is not stored |
| `boards` | The boards the import wrote, so the caller can open one |

An empty `unresolved`, `keptAsText`, `attachments`, `skipped` and `notes` means nothing was lost.

## What it does not carry

Attachment bytes, canvas edge sides, and hex colours. Each one is reported in the summary instead of being
approximated: an image becomes its file name as text, an edge takes the default connector layout, and a
colour the palette cannot name is listed under `colours.unmapped`.

## Test it

The fixture vault in `packages/import-obsidian/fixtures/vault` covers a nested folder, frontmatter with tags
and custom keys, a wikilink to a note in the vault, a wikilink to a missing note, a canvas with all four node
types and two edges, and an embedded image.

```sh
pnpm exec vitest run --project importer
```

No test reads a live vault. A new mapping row needs a fixture file that exercises it.
