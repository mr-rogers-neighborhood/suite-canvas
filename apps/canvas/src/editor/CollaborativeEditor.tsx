import Collaboration from "@tiptap/extension-collaboration";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type * as Y from "yjs";

export interface CollaborativeEditorProps {
  doc: Y.Doc;
}

export function CollaborativeEditor({ doc }: CollaborativeEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        undoRedo: false,
      }),
      Collaboration.configure({
        document: doc,
        field: "prosemirror",
      }),
    ],
    editorProps: {
      attributes: {
        class:
          "min-h-[240px] rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-800 focus:outline-none",
      },
    },
  });

  return (
    <div data-testid="editor-panel" className="flex h-full flex-col">
      <h2 className="mb-2 text-sm font-semibold text-gray-600">Collaborative note</h2>
      <EditorContent editor={editor} />
    </div>
  );
}
