import type { Meta, StoryObj } from "@storybook/react-vite";
import { EditorState } from "@tiptap/pm/state";
import { getSchema } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { type ContainerID, LoroDoc } from "loro-crdt";
import { type LoroDocType, updateLoroToPmState } from "loro-prosemirror";
import { CardBodyEditor } from "./CardBodyEditor";

const schema = getSchema([StarterKit]);

function seedBody(): { doc: LoroDoc; contentId: ContainerID } {
  const doc = new LoroDoc();
  const contentId = doc.getMap("content").ensureMergeableMap("n1").id;
  const body = schema.node("doc", null, [
    schema.node("heading", { level: 1 }, [schema.text("A heading")]),
    schema.node("heading", { level: 2 }, [schema.text("A subheading")]),
    schema.node("paragraph", null, [schema.text("Body text.")]),
    schema.node("bulletList", null, [
      schema.node("listItem", null, [
        schema.node("paragraph", null, [schema.text("First bullet")]),
      ]),
      schema.node("listItem", null, [
        schema.node("paragraph", null, [schema.text("Second bullet")]),
      ]),
    ]),
    schema.node("orderedList", null, [
      schema.node("listItem", null, [schema.node("paragraph", null, [schema.text("First step")])]),
      schema.node("listItem", null, [schema.node("paragraph", null, [schema.text("Second step")])]),
    ]),
    schema.node("blockquote", null, [schema.node("paragraph", null, [schema.text("A quote")])]),
    schema.node("codeBlock", { language: "ts" }, [schema.text("const answer = 42;")]),
    schema.node("horizontalRule"),
  ]);
  updateLoroToPmState(
    doc as unknown as LoroDocType,
    new Map(),
    EditorState.create({ schema, doc: body }),
    contentId,
    "text:body",
  );
  return { doc, contentId };
}

const { doc, contentId } = seedBody();

const meta = {
  title: "Components/CardBodyEditor",
  component: CardBodyEditor,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-[360px] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-2">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof CardBodyEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Blocks: Story = {
  args: {
    cardId: "n1",
    cardDoc: doc,
    contentId,
    cursorStore: null,
    localUser: null,
    editable: false,
  },
};
