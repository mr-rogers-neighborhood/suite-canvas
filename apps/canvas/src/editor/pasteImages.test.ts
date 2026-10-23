import { Slice } from "@tiptap/pm/model";
import type { EditorProps } from "@tiptap/pm/view";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureSession } from "../session/session";
import { ATTACHMENT_NODE_NAME, Attachment } from "./attachmentNode";
import {
  PasteImages,
  type PasteImagesOptions,
  type PasteUpload,
  relayUploader,
} from "./pasteImages";

const ID = "fedcba9876543210fedcba9876543210";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

interface Recorder {
  uploads: PasteUpload[];
  stored: { id: string; bytes: Uint8Array; mime: string }[];
}

function createEditor(options: Partial<PasteImagesOptions> = {}): {
  editor: Editor;
  recorder: Recorder;
} {
  const recorder: Recorder = { uploads: [], stored: [] };
  editor = new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Attachment,
      PasteImages.configure({
        upload: null,
        newId: () => ID,
        measure: async () => ({ width: 800, height: 600 }),
        storeLocal: async (id, bytes, mime) => {
          recorder.stored.push({ id, bytes, mime });
        },
        ...options,
      }),
    ],
    content: "",
  });
  return { editor, recorder };
}

function clipboardEvent(files: File[]): ClipboardEvent {
  const items = files.map((file) => ({
    kind: "file",
    type: file.type,
    getAsFile: () => file,
  }));
  return {
    clipboardData: { items, types: files.map((file) => file.type), getData: () => "" },
  } as unknown as ClipboardEvent;
}

/** Runs the plugin's paste handler the way ProseMirror would. */
function paste(instance: Editor, files: File[]): boolean {
  // ProseMirror's own prop type, so the void return of an unhandled paste is
  // the library's, not a hand-written union in this file.
  type Handler = NonNullable<EditorProps["handlePaste"]>;
  return Boolean(
    instance.view.someProp("handlePaste", (handler: Handler) =>
      handler(instance.view, clipboardEvent(files), Slice.empty),
    ),
  );
}

function attachmentNode(instance: Editor): { attrs: Record<string, unknown> } | null {
  let found: { attrs: Record<string, unknown> } | null = null;
  instance.state.doc.descendants((node) => {
    if (node.type.name === ATTACHMENT_NODE_NAME) found = { attrs: node.attrs };
    return true;
  });
  return found;
}

describe("pasting an image", () => {
  it("creates an attachment node with the id, type, size and name", async () => {
    const { editor: instance, recorder } = createEditor();
    const file = new File([PNG], "diagram.png", { type: "image/png" });

    expect(paste(instance, [file])).toBe(true);

    const node = await vi.waitFor(() => {
      const found = attachmentNode(instance);
      expect(found).not.toBeNull();
      return found as { attrs: Record<string, unknown> };
    });
    expect(node.attrs).toEqual({
      id: ID,
      mime: "image/png",
      width: 800,
      height: 600,
      name: "diagram.png",
      bytes: PNG.byteLength,
    });
    expect(recorder.uploads).toHaveLength(0);
  });

  it("keeps the bytes locally under the node's id when there is no relay", async () => {
    const { editor: instance, recorder } = createEditor();
    paste(instance, [new File([PNG], "shot.png", { type: "image/png" })]);

    await vi.waitFor(() => expect(recorder.stored).toHaveLength(1));
    expect(recorder.stored[0]?.id).toBe(ID);
    expect(recorder.stored[0]?.mime).toBe("image/png");
    expect(Array.from(recorder.stored[0]?.bytes ?? [])).toEqual(Array.from(PNG));
  });

  it("uploads when a relay is configured and keeps no local copy", async () => {
    const { editor: instance, recorder } = createEditor({
      upload: async (input) => {
        recorder.uploads.push(input);
      },
    });
    paste(instance, [new File([PNG], "shot.png", { type: "image/png" })]);

    await vi.waitFor(() => expect(recorder.uploads).toHaveLength(1));
    expect(recorder.uploads[0]?.id).toBe(ID);
    expect(recorder.uploads[0]?.mime).toBe("image/png");
    expect(Array.from(recorder.uploads[0]?.bytes ?? [])).toEqual(Array.from(PNG));
    expect(recorder.stored).toHaveLength(0);
  });

  it("falls back to a local copy when the upload fails", async () => {
    const { editor: instance, recorder } = createEditor({
      upload: async () => {
        throw new Error("relay is down");
      },
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    paste(instance, [new File([PNG], "shot.png", { type: "image/png" })]);

    await vi.waitFor(() => expect(recorder.stored).toHaveLength(1));
    expect(attachmentNode(instance)).not.toBeNull();
    warning.mockRestore();
  });

  it("leaves a paste with no image to the editor", async () => {
    const { editor: instance, recorder } = createEditor();
    const text = new File(["hello"], "notes.txt", { type: "text/plain" });

    expect(paste(instance, [text])).toBe(false);
    expect(recorder.stored).toHaveLength(0);
    expect(attachmentNode(instance)).toBeNull();
  });
});

describe("relay uploader", () => {
  it("is absent without an owner key, and present on an owner session", () => {
    configureSession({
      workspaceId: "ws-1",
      roomId: "ws-1",
      share: null,
      role: "editor",
      readOnly: false,
      ownerKey: "owner-key-1",
    });
    expect(relayUploader()).not.toBeNull();

    // A share session never holds an owner key, so it never uploads.
    configureSession({
      workspaceId: "ws-1",
      roomId: "ws-1",
      share: null,
      role: "editor",
      readOnly: false,
      ownerKey: null,
    });
    expect(relayUploader()).toBeNull();
  });
});
