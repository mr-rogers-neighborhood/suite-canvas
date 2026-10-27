import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  boardSchema,
  cardSchema,
  cardTypeSchema,
  fieldDefinitionSchema,
  graphEdgeSchema,
  placementSchema,
  propertyValueSchema,
  sectionSchema,
  tagSchema,
} from "./schema.js";
import { savedViewSchema, viewQuerySchema } from "./views.js";
import {
  workspaceFileAttachmentSchema,
  workspaceFileManifestSchema,
  workspaceFileSchema,
} from "./workspaceFile.js";
import { workspaceTemplateSchema } from "./workspaceTemplate.js";

/**
 * The schemas a document from somewhere else passes through before this build
 * touches it: a `.suite` backup, a template row from the template API, a view
 * that arrived inside a share link, and the records the CRDT carries when a
 * peer's operation lands.
 *
 * Two properties are worth pinning, and neither is about a shape we thought of:
 *
 *   1. `safeParse` answers for any value. A throw here is a crash in the import
 *      path, where the input is whatever the other machine wrote.
 *   2. What the schema accepts, it accepts again unchanged. A parse whose
 *      output does not survive a second parse means a document that edits
 *      itself on load, and the second parse is the one that runs after a
 *      reload.
 */
interface Candidate {
  readonly name: string;
  readonly schema: z.ZodType<unknown>;
  /**
   * One document of this shape that parses. Generated input alone is almost
   * always rejected, and a property that never reaches the accepted branch
   * proves nothing about the accepted branch.
   */
  readonly sample: unknown;
}

const candidates: readonly Candidate[] = [
  {
    name: "workspace file",
    schema: workspaceFileSchema,
    sample: {
      kind: "suite.workspace",
      version: 2,
      schemaVersion: 1,
      exportedAt: "2026-10-22T00:00:00.000Z",
      workspaceId: "ws-1",
      document: "AA==",
      manifest: { boards: 1, cards: 1, types: 1, tags: 0 },
    },
  },
  {
    name: "workspace file manifest",
    schema: workspaceFileManifestSchema,
    sample: { boards: 1, cards: 1, types: 1, tags: 0 },
  },
  {
    name: "workspace file attachment",
    schema: workspaceFileAttachmentSchema,
    sample: { mime: "image/png", name: "", width: 8, height: 8, data: "AA==" },
  },
  {
    name: "workspace template",
    schema: workspaceTemplateSchema,
    sample: {
      id: "notebook",
      name: "Notebook",
      description: "One board, one section, one card.",
      version: 1,
      boards: [
        {
          key: "home",
          name: "Home",
          sections: [
            {
              title: "Start",
              x: 0,
              y: 0,
              width: 400,
              height: 300,
              cards: [{ key: "welcome", title: "Welcome", x: 20, y: 20 }],
            },
          ],
        },
      ],
    },
  },
  {
    name: "saved view",
    schema: savedViewSchema,
    sample: {
      id: "v1",
      name: "Recent",
      position: 0,
      query: {
        typeIds: [],
        tagIds: [],
        sectionIds: [],
        scope: "all",
        groupBySection: false,
        order: "updated",
      },
    },
  },
  {
    name: "view query",
    schema: viewQuerySchema,
    sample: {
      typeIds: [],
      tagIds: [],
      sectionIds: [],
      scope: "board",
      groupBySection: true,
      order: "title",
    },
  },
  {
    name: "board",
    schema: boardSchema,
    sample: { id: "b1", name: "Board", tags: [], createdAt: 0, updatedAt: 0 },
  },
  {
    name: "card",
    schema: cardSchema,
    sample: {
      id: "c1",
      createdAt: 0,
      updatedAt: 0,
      connectors: [],
      typeIds: ["note"],
      primaryTypeId: "note",
      tags: [],
      properties: {},
    },
  },
  {
    name: "card type",
    schema: cardTypeSchema,
    sample: { id: "note", name: "Note", glyph: "N", createdAt: 0, updatedAt: 0, fields: [] },
  },
  {
    name: "field definition",
    schema: fieldDefinitionSchema,
    sample: { id: "f1", name: "Status", kind: "text", required: false, order: 0, options: [] },
  },
  {
    name: "tag",
    schema: tagSchema,
    sample: { id: "t1", name: "reading", createdAt: 0 },
  },
  {
    name: "placement",
    schema: placementSchema,
    sample: { boardId: "b1", cardId: "c1", x: 0, y: 0, z: 0, createdAt: 0 },
  },
  {
    name: "section",
    schema: sectionSchema,
    sample: {
      id: "s1",
      boardId: "b1",
      title: "Section",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      z: 0,
      tags: [],
      createdAt: 0,
      updatedAt: 0,
    },
  },
  {
    name: "edge",
    schema: graphEdgeSchema,
    sample: {
      id: "e1",
      boardId: "b1",
      source: "c1",
      target: "c2",
      kind: "references",
      path: "bezier",
      bidirectional: false,
      createdAt: 0,
      updatedAt: 0,
    },
  },
  {
    name: "property value",
    schema: propertyValueSchema,
    sample: { status: "draft", weight: 3 },
  },
];

/**
 * A valid document with one key removed, one key replaced, or one key added.
 * Cheap to generate, and it keeps the accepted branch reachable: most JSON
 * values fail every one of these schemas on the first key.
 */
const damagedSample = (sample: unknown): fc.Arbitrary<unknown> => {
  if (typeof sample !== "object" || sample === null) return fc.constant(sample);
  const keys = Object.keys(sample);
  return fc
    .record({
      dropped: fc.option(fc.constantFrom(...keys), { nil: undefined }),
      replacement: fc.option(fc.jsonValue(), { nil: undefined }),
      extra: fc.option(fc.tuple(fc.string(), fc.jsonValue()), { nil: undefined }),
    })
    .map(({ dropped, replacement, extra }) => {
      const copy: Record<string, unknown> = { ...sample };
      if (dropped !== undefined) delete copy[dropped];
      if (replacement !== undefined) {
        const target = keys[0];
        if (target !== undefined) copy[target] = replacement;
      }
      if (extra !== undefined) copy[extra[0]] = extra[1];
      return copy;
    });
};

describe.each(candidates.map((candidate) => [candidate.name, candidate] as const))(
  "%s schema",
  (_name, candidate) => {
    it("should answer for any value instead of throwing", () => {
      fc.assert(
        fc.property(fc.anything(), (value) => {
          const result = candidate.schema.safeParse(value);
          expect(typeof result.success).toBe("boolean");
        }),
      );
    });

    it("should return a document that parses to itself", () => {
      fc.assert(
        fc.property(fc.oneof(fc.jsonValue(), damagedSample(candidate.sample)), (value) => {
          const first = candidate.schema.safeParse(value);
          if (!first.success) return;
          const second = candidate.schema.safeParse(first.data);
          expect(second.success).toBe(true);
          if (second.success) expect(second.data).toEqual(first.data);
        }),
      );
    });

    it("should accept its own sample", () => {
      expect(candidate.schema.safeParse(candidate.sample).success).toBe(true);
    });
  },
);
