import {
  RICH_TEXT_MARK_NAMES,
  RICH_TEXT_NODE_ATTRIBUTE_NAMES,
  RICH_TEXT_NODE_NAMES,
} from "@suite/graph";
import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";
import { cardBodySchemaExtensions } from "./cardEditorExtensions";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

/**
 * The body editor's schema, built the way `CardBodyEditor` builds it minus
 * `LoroCollaboration`, which adds plugins and shortcuts but no nodes or marks.
 */
function createEditor(): Editor {
  editor = new Editor({
    extensions: cardBodySchemaExtensions({
      cardId: "schema-contract-card",
      placeholder: "Write something",
    }),
    content: "<p>Hello</p>",
  });
  return editor;
}

/** Sorted difference in both directions, for a readable failure message. */
function drift(actual: string[], expected: readonly string[]) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return {
    missing: [...expectedSet].filter((name) => !actualSet.has(name)).sort(),
    extra: [...actualSet].filter((name) => !expectedSet.has(name)).sort(),
  };
}

function expectNoDrift(actual: string[], expected: readonly string[], label: string): void {
  const { missing, extra } = drift(actual, expected);
  expect(
    { missing, extra },
    [
      `${label} drifted from the publish allowlist.`,
      missing.length > 0 ? `Missing from the allowlist: ${missing.join(", ")}.` : "",
      extra.length > 0 ? `Not publishable but in the schema: ${extra.join(", ")}.` : "",
      "Update packages/graph/src/publishValidation.ts when adding an editor extension.",
    ]
      .filter(Boolean)
      .join(" "),
  ).toEqual({ missing: [], extra: [] });
}

describe("editor schema contract", () => {
  it("should publish every node the body editor can produce", () => {
    expectNoDrift(Object.keys(createEditor().schema.nodes), RICH_TEXT_NODE_NAMES, "Node names");
  });

  it("should publish every mark the body editor can produce", () => {
    expectNoDrift(Object.keys(createEditor().schema.marks), RICH_TEXT_MARK_NAMES, "Mark names");
  });

  it("should allow exactly the attributes each node declares", () => {
    const schema = createEditor().schema;
    for (const nodeName of RICH_TEXT_NODE_NAMES) {
      const declared = Object.keys(schema.nodes[nodeName]?.spec.attrs ?? {}).sort();
      const allowed = [...RICH_TEXT_NODE_ATTRIBUTE_NAMES[nodeName]].sort();
      expect(
        declared,
        `Node "${nodeName}" declares attributes [${declared.join(", ")}] but the publish allowlist has [${allowed.join(", ")}].`,
      ).toEqual(allowed);
    }
  });
});
