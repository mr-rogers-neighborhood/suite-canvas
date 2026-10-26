# Change the data model

A record change travels one path: schema, reader, writer, facade, then the tests that prove two clients
still converge. Skipping the reader step is how a field appears on one client and vanishes on reload.
[data-model.md](../reference/data-model.md) explains why each layer exists; this page is the order to edit
them in.

The example is a `accent` colour on a board, which is a leaf on an existing record. A new nested container,
a new record kind and a change to a derived index each touch a different subset of the same files, and the
subsets are listed at the end.

## Decide what kind of change it is

| Change | Needs a schema bump | First file to edit |
| --- | --- | --- |
| A new optional leaf on an existing record | no | `packages/graph/src/schema.ts` |
| A new nested map or set inside a record | no | `packages/graph/src/schema.ts` |
| A new record kind under an existing root | no | `packages/graph/src/schema.ts` |
| A new root | yes, and a facade constant | `packages/graph/src/loro/keys.ts` |
| An existing field changes meaning or type | yes | a new decision in `docs/decisions/` first |

`SCHEMA_VERSION` in `packages/graph/src/loro/constants.ts` is the version of the document shape, currently
`4`. It moves when a document written by this build can no longer be read by the previous one, or when an
old value means something new. Adding an optional field does not move it, because the previous build ignores
a key it does not know.

## 1. Describe the record

`packages/graph/src/schema.ts` is the only description of the shape, and the TypeScript type is inferred
from it.

```ts
export const boardSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  color: sectionColorSchema.optional(),
  // …
  accent: z.string().regex(/^#[0-9a-f]{6}$/u).optional(),
});
```

Keep the field optional unless every existing document can supply a value. `exactOptionalPropertyTypes` is
on, so a `undefined` write is not the same as no key: the writer deletes the key instead.

Run the schema tests while editing:

```sh
pnpm exec vitest run packages/graph/src/schema.test.ts
```

Add a parse case and a reject case to `packages/graph/src/schema.test.ts`. A reject case that only checks
that something throws is not enough; assert which field the error names.

## 2. Read it back

`packages/graph/src/records/` holds the one reader per record kind.

| Record | Reader |
| --- | --- |
| Card | `cardFromMap` in `records/cards.ts` |
| Board, placement, section, edge, tag, type, field | `records/entities.ts` |
| Surface style and theme values | `records/values.ts` |
| Property values, including composite kinds | `records/propertyValues.ts` |

Read through the existing helpers rather than reaching into the map: `readString`, `readNumber`, `readIdSet`
and `readSurfaceStyle` in `records/values.ts` already handle an absent key.

An older document must read as a complete record. When the field has a sensible default, apply it in the
reader. When the default depends on other records, apply it in `normalizeCard`, which is the one place a
card is turned into a complete shape.

Test the reader beside the writer. When the case is "a document written before this field existed still
opens", build the old shape with raw Loro in the test, as
`packages/graph/src/loro/boardSectionTags.test.ts` does for a board stored before tags existed.

## 3. Write it

Add the method to the module that owns the record under `packages/graph/src/loro/`: `boards.ts`, `edges.ts`,
`placements.ts`, `sections.ts`, `tags.ts`, `cardTypes.ts`, `views.ts`, or `cards/` for anything on a card.

```ts
setBoardAccent(id: string, accent: string | null): void {
  const fields = ctx.boards.get(id);
  if (!isMap(fields)) return;
  if (accent === null) fields.delete("accent");
  else fields.set("accent", accent);
  fields.set("updatedAt", Date.now());
  ctx.commit(`${STRUCT_ORIGIN}board-accent`);
}
```

Rules that the review will ask about:

- Write the leaf. `mutateCard(cardId, (fields) => fields.set(...))` exists for one field on a card, and a
  new `setCard(wholeCard)` call for one field is rejected because it reverts a concurrent rename.
- A set is a map. Use `writeIdSet` or `fields.ensureMergeableMap("tags")` so two peers adding different ids
  both keep theirs.
- Reads do not create. If the new value is a container an editor mounts, add a `peek*` read that returns
  `null` and an ensuring write that creates it, instead of one read that does both.
- One commit per gesture. `ctx.commit(origin)` once at the end, or `ctx.batch(origin, fn)` when the caller
  already groups a gesture.
- Validate at the write with the schema, as every other `set*` method does.

Test it in the module's own test file. `packages/graph/src/loro/workspace.convergence.test.ts` and
`packages/graph/src/merge.property.test.ts` show the two-document pattern: build the same document twice,
apply the new write on one and a different write on the other, merge, and assert neither edit is lost.

## 4. Expose it on the facade

`WorkspaceDocument.ts` delegates to the domain module. A card method goes on `CardsFacade` in
`packages/graph/src/loro/facade/cards.ts`; everything else goes on the facade class.

- A method that a canvas component calls needs a line here, spelled exactly as the domain module spells it.
- A new domain module is composed in `packages/graph/src/loro/api.ts` and given a field on `DocApi`.
- A type a caller outside the package needs is exported from `packages/graph/src/index.ts`.

Then check the shape rules, which fail on a file over 900 lines, a second `WorkspaceDocument.observe` call
site, or a raw Loro write outside the graph package:

```sh
node scripts/check-shape.mjs
```

## 5. Carry it through publish and projection

A share editor publishes a plan, so a field that a draft can edit needs the whole path:

| Step | File |
| --- | --- |
| Capture the value from the draft | `packages/graph/src/publish/snapshot.ts` |
| Compare draft, baseline and source | `packages/graph/src/publish/planCards.ts` |
| Reject a key the scope may not publish | `packages/graph/src/publish/planGuards.ts` |
| Replay the captured value | `packages/graph/src/publish/apply.ts` |
| Add a cap, if the field is bounded | `packages/graph/src/publish/validation/limits.ts` |

`apply.ts` keeps one named applier per change kind, so a new kind is a new function and one line in the
`APPLIERS` table.

A field a share must show also travels through the projection: `packages/graph/src/projection/workspace.ts`
for the selection, `packages/graph/src/projection/containers.ts` for text, and
`packages/graph/src/projection/references.ts` for a reference that stays behind. A field left out of the
projection is invisible to every viewer, and no error says so.

## 6. Repair documents already stored

There is no migration script. A document is repaired by the normalising reader on open, or by an explicit
repair method that is idempotent and safe to run on every client:

- A leaf with a default: fix it in the reader.
- A derived set: add it to `ensureReferences`-style repair, which compares and writes only what differs.
- A renamed key: read both spellings in the reader, write the new one on the next edit.

A test that builds the old shape with raw Loro is the proof, and a test file is the only place that may do
it. `packages/graph/src/loro/boardSectionTags.test.ts` is the model: raw maps for the stored shape, then the
public read.

## 7. Verify and document

```sh
pnpm exec vitest run --project graph
pnpm --filter @suite/graph typecheck
pnpm biome check packages/graph/src
node scripts/check-docs-symbols.mjs
```

Update the record table in [data-model.md](../reference/data-model.md) when the shape changes. A new cap is
a constant in `config/limits.ts` plus a regenerated [limits.md](../reference/limits.md); never hand-edit the
numbers, because `node scripts/generate-limits.mjs --check` fails on a stale page.

## Subsets for the other cases

A new nested container, such as a per-card checklist: steps 1 to 4, plus a migration note in step 6, and no
publish change until a draft may edit it.

A new record kind under an existing root: steps 1 to 4. Add `list*` and `get*` on the domain module, because
a record nobody can list is not reachable by the canvas.

A new root: add the key to `STRUCT_KEYS`, add it to `WorkspaceDocument.ROOT_KEYS`, open it in the facade
constructor, and check `apps/collab-server/src/store/` and `packages/graph/src/projection/` for anything that
copies roots by name.

A change to the reference index only: edit `packages/graph/src/loro/cards/references.ts`, keep the recompute
`INDEX_ORIGIN`-tagged, and add a case to `packages/graph/src/references.test.ts`.
