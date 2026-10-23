import { render, screen, waitFor } from "@testing-library/react";
import { type Editor, EditorContent, type JSONContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FakeIndexedDb, installFakeIndexedDb } from "../test/fakeIndexedDb";
import { PENDING_UPLOAD_NOTICE } from "./AttachmentView";
import {
  ATTACHMENT_NODE_NAME,
  Attachment,
  attachmentUploadState,
  markAttachmentUploaded,
  storeLocalAttachment,
} from "./attachmentNode";
import { IMAGE_NODE_NAME, ImageLink } from "./imageLinkNode";

const ID = "0123456789abcdef0123456789abcdef";
const DATABASE = "suite-attachments";
const STORE = "bytes";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

let fake: FakeIndexedDb;

beforeEach(() => {
  fake = installFakeIndexedDb();
});

afterEach(() => {
  fake.restore();
  vi.unstubAllEnvs();
});

function imageBody(attrs: Record<string, unknown>): JSONContent {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: ATTACHMENT_NODE_NAME, attrs }] }],
  };
}

function Harness({ content }: { content: JSONContent }) {
  const editor: Editor | null = useEditor({
    extensions: [StarterKit.configure({ undoRedo: false }), Attachment, ImageLink],
    content,
  });
  if (!editor) return null;
  return <EditorContent editor={editor} />;
}

describe("attachment upload state", () => {
  it("reads local after a failed upload, and still local after a reload", async () => {
    // The exact write `pasteImages` makes when the relay refuses or is absent.
    await storeLocalAttachment(ID, PNG, "image/png");

    expect(await attachmentUploadState(ID)).toBe("local");
    // A reload opens a fresh connection against the same durable store; the
    // fact must come back, not reset to "unknown".
    expect(await attachmentUploadState(ID)).toBe("local");
  });

  it("flips to synced when the relay accepts the bytes and drops the caption", async () => {
    await storeLocalAttachment(ID, PNG, "image/png");
    const { unmount } = render(
      <Harness content={imageBody({ id: ID, mime: "image/png", name: "diagram.png" })} />,
    );

    expect(await screen.findByText(PENDING_UPLOAD_NOTICE)).toBeInTheDocument();
    await screen.findByAltText("diagram.png");

    await markAttachmentUploaded(ID);
    expect(await attachmentUploadState(ID)).toBe("synced");

    unmount();
    render(<Harness content={imageBody({ id: ID, mime: "image/png", name: "diagram.png" })} />);
    await screen.findByAltText("diagram.png");
    await waitFor(() => expect(screen.queryByText(PENDING_UPLOAD_NOTICE)).toBeNull());
  });

  it("reads unknown, and shows no caption, for a record written before the flag", async () => {
    // No `uploadState`: exactly the shape the previous build wrote.
    fake.seed(DATABASE, STORE, { id: ID, mime: "image/png", bytes: PNG, createdAt: Date.now() });

    expect(await attachmentUploadState(ID)).toBe("unknown");

    render(<Harness content={imageBody({ id: ID, mime: "image/png", name: "diagram.png" })} />);
    await screen.findByAltText("diagram.png");
    expect(screen.queryByText(PENDING_UPLOAD_NOTICE)).toBeNull();
  });

  it("shows no caption in a standalone build, even for a local record", async () => {
    vi.stubEnv("VITE_SUITE_MODE", "standalone");
    await storeLocalAttachment(ID, PNG, "image/png");
    expect(await attachmentUploadState(ID)).toBe("local");

    render(<Harness content={imageBody({ id: ID, mime: "image/png", name: "diagram.png" })} />);
    await screen.findByAltText("diagram.png");
    expect(screen.queryByText(PENDING_UPLOAD_NOTICE)).toBeNull();
  });

  it("never reads a URL image node as pending: it has no bytes at all", async () => {
    const src = "https://cdn.example.com/shots/relay.png";
    expect(await attachmentUploadState(src)).toBe("unknown");

    render(
      <Harness
        content={{
          type: "doc",
          content: [{ type: IMAGE_NODE_NAME, attrs: { src, alt: "relay.png" } }],
        }}
      />,
    );
    await screen.findByAltText("relay.png");
    expect(screen.queryByText(PENDING_UPLOAD_NOTICE)).toBeNull();
    expect(screen.queryByText(/not uploaded/iu)).toBeNull();
  });
});
