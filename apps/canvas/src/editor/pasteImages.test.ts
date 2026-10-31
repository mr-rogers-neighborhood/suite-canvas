import { Slice } from "@tiptap/pm/model";
import type { EditorProps } from "@tiptap/pm/view";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureSession } from "../session/session";
import { installFakeIndexedDb } from "../test/fakeIndexedDb";
import { Attachment, attachmentUploadState, storeLocalAttachment } from "./attachmentNode";
import { ImageLink } from "./imageLinkNode";
import { MEDIA_NODE_NAME, Media } from "./mediaNode";
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
      ImageLink,
      Media,
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

function clipboardEvent(files: File[], text = ""): ClipboardEvent {
  const items = files.map((file) => ({
    kind: "file",
    type: file.type,
    getAsFile: () => file,
  }));
  return {
    clipboardData: {
      items,
      types: files.map((file) => file.type),
      getData: (type: string) => (type === "text/plain" ? text : ""),
    },
  } as unknown as ClipboardEvent;
}

/** Runs the plugin's paste handler the way ProseMirror would. */
function paste(instance: Editor, files: File[], text = ""): boolean {
  // ProseMirror's own prop type, so the void return of an unhandled paste is
  // the library's, not a hand-written union in this file.
  type Handler = NonNullable<EditorProps["handlePaste"]>;
  return Boolean(
    instance.view.someProp("handlePaste", (handler: Handler) =>
      handler(instance.view, clipboardEvent(files, text), Slice.empty),
    ),
  );
}

/** The media block whose bytes are stored beside the document. */
function attachmentNode(instance: Editor): { attrs: Record<string, unknown> } | null {
  let found: { attrs: Record<string, unknown> } | null = null;
  instance.state.doc.descendants((node) => {
    if (node.type.name !== MEDIA_NODE_NAME) return true;
    if (typeof node.attrs.id === "string") found = { attrs: node.attrs };
    return true;
  });
  return found;
}

/** The media block that names a third-party address instead of storing bytes. */
function imageLinkNode(instance: Editor): { attrs: Record<string, unknown> } | null {
  let found: { attrs: Record<string, unknown> } | null = null;
  instance.state.doc.descendants((node) => {
    if (node.type.name !== MEDIA_NODE_NAME) return true;
    if (typeof node.attrs.src === "string" && node.attrs.id == null) found = { attrs: node.attrs };
    return true;
  });
  return found;
}

describe("routing a paste by what the clipboard carries", () => {
  it("should make a link node out of clipboard text that is one image URL", () => {
    const { editor: instance, recorder } = createEditor();

    expect(paste(instance, [], "https://cdn.example.com/shots/relay.png")).toBe(true);

    expect(imageLinkNode(instance)?.attrs).toMatchObject({
      kind: "image",
      src: "https://cdn.example.com/shots/relay.png",
      alt: "relay.png",
      width: null,
      height: null,
    });
    expect(attachmentNode(instance)).toBeNull();
    expect(recorder.stored).toHaveLength(0);
  });

  it("should keep the bytes when the clipboard carries an image and its URL", async () => {
    const { editor: instance } = createEditor();
    const file = new File([PNG], "diagram.png", { type: "image/png" });

    expect(paste(instance, [file], "https://cdn.example.com/shots/relay.png")).toBe(true);

    await vi.waitFor(() => expect(attachmentNode(instance)).not.toBeNull());
    expect(imageLinkNode(instance)).toBeNull();
  });

  it("should leave ordinary prose and non-image links to the default paste", () => {
    const { editor: instance } = createEditor();

    expect(paste(instance, [], "read https://cdn.example.com/shots/relay.png later")).toBe(false);
    expect(paste(instance, [], "https://example.com/an-article")).toBe(false);
    expect(paste(instance, [], "javascript:alert(1)")).toBe(false);
    expect(paste(instance, [], "https://example.com/a.png and more")).toBe(false);
    expect(imageLinkNode(instance)).toBeNull();
  });
});

describe("pasting an image", () => {
  it("creates a media block with the id, type, size and name", async () => {
    const { editor: instance, recorder } = createEditor();
    const file = new File([PNG], "diagram.png", { type: "image/png" });

    expect(paste(instance, [file])).toBe(true);

    const node = await vi.waitFor(() => {
      const found = attachmentNode(instance);
      expect(found).not.toBeNull();
      return found as { attrs: Record<string, unknown> };
    });
    expect(node.attrs).toMatchObject({
      kind: "image",
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

  it("records that a failed upload's bytes are local-only, durably", async () => {
    const fake = installFakeIndexedDb();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { editor: instance } = createEditor({
        upload: async () => {
          throw new Error("relay is down");
        },
        // The real write, backed by the fake IndexedDB, not just a recorder.
        storeLocal: async (id, bytes, mime) => {
          await storeLocalAttachment(id, bytes, mime);
        },
      });
      paste(instance, [new File([PNG], "shot.png", { type: "image/png" })]);

      await vi.waitFor(async () => {
        expect(await attachmentUploadState(ID)).toBe("local");
      });
      // A reload re-reads the store: the fact did not live in a transient set.
      expect(await attachmentUploadState(ID)).toBe("local");
    } finally {
      warning.mockRestore();
      fake.restore();
    }
  });

  it("flips a local record to synced when the relay accepts the same id", async () => {
    const fake = installFakeIndexedDb();
    try {
      // What an earlier failed attempt (or an import) left behind.
      await storeLocalAttachment(ID, PNG, "image/png");
      expect(await attachmentUploadState(ID)).toBe("local");

      const { editor: instance } = createEditor({
        upload: async () => {},
        newId: () => ID,
      });
      paste(instance, [new File([PNG], "shot.png", { type: "image/png" })]);

      await vi.waitFor(async () => {
        expect(await attachmentUploadState(ID)).toBe("synced");
      });
    } finally {
      fake.restore();
    }
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
  it("is absent without an account session, and present on one", () => {
    configureSession({
      workspaceId: "ws-1",
      roomId: "ws-1",
      share: null,
      role: "editor",
      readOnly: false,
      credential: "account",
    });
    expect(relayUploader()).not.toBeNull();

    // A share session presents a link token, so it never uploads.
    configureSession({
      workspaceId: "ws-1",
      roomId: "ws-1",
      share: null,
      role: "editor",
      readOnly: false,
      credential: "share",
    });
    expect(relayUploader()).toBeNull();
  });
});
