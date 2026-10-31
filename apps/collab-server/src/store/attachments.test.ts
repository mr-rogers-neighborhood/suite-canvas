import { describe, expect, it } from "vitest";
import {
  AttachmentCapError,
  AttachmentExistsError,
  attachmentMimeProblem,
  createSqliteAttachmentStore,
  gcAttachments,
  isAttachmentMime,
  newAttachmentId,
} from "./attachments.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function store(cap = Number.POSITIVE_INFINITY) {
  return createSqliteAttachmentStore(":memory:", { cap: () => cap });
}

describe("attachment content types", () => {
  it("accepts the image types it can serve and refuses markup with a reason", () => {
    expect(attachmentMimeProblem("image/png")).toBeNull();
    expect(attachmentMimeProblem("IMAGE/JPEG; charset=binary")).toBeNull();
    expect(attachmentMimeProblem("video/mp4")).toBeNull();
    expect(attachmentMimeProblem("video/webm")).toBeNull();
    expect(isAttachmentMime("image/webp")).toBe(true);
    expect(isAttachmentMime("video/mp4")).toBe(true);

    const html = attachmentMimeProblem("text/html");
    expect(html).toContain("HTML is not accepted");
    expect(html).toContain("image or video");

    const svg = attachmentMimeProblem("image/svg+xml");
    expect(svg).toContain("SVG is not accepted");
    expect(svg).toContain("can carry script");

    expect(attachmentMimeProblem("application/octet-stream")).toContain("Unsupported");
  });
});

describe("attachment store", () => {
  it("returns the exact bytes it was given", () => {
    const attachments = store();
    const meta = attachments.put("ws-1", PNG, "image/png");
    expect(meta.size).toBe(PNG.byteLength);

    const record = attachments.get(meta.id);
    expect(record).not.toBeNull();
    expect(Array.from(record?.bytes ?? [])).toEqual(Array.from(PNG));
    expect(record?.mime).toBe("image/png");
    expect(record?.workspaceId).toBe("ws-1");
    expect(attachments.usage("ws-1")).toBe(PNG.byteLength);
    attachments.close();
  });

  it("refuses a put that would exceed the workspace cap, and stores nothing", () => {
    const attachments = store(20);
    attachments.put("ws-1", PNG, "image/png");
    expect(attachments.usage("ws-1")).toBe(PNG.byteLength);

    let refusal: unknown = null;
    try {
      attachments.put("ws-1", new Uint8Array(50), "image/png");
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(AttachmentCapError);
    expect((refusal as AttachmentCapError).reason).toBe("attachment-cap");
    // The message is the operator's: what is used, what the cap is, what to do.
    expect((refusal as Error).message).toContain("SUITE_ATTACHMENT_BYTES_PER_WORKSPACE");
    expect(attachments.usage("ws-1")).toBe(PNG.byteLength);
    attachments.close();
  });

  it("uses a client-chosen id, refuses a duplicate, and validates the id it is given", () => {
    const attachments = store();
    const chosen = newAttachmentId();
    const meta = attachments.put("ws-1", PNG, "image/png", { id: chosen });
    expect(meta.id).toBe(chosen);
    expect(() => attachments.put("ws-1", PNG, "image/png", { id: chosen })).toThrow(
      AttachmentExistsError,
    );
    expect(() => attachments.put("ws-1", PNG, "image/png", { id: "not-an-id" })).toThrow(
      /32 lowercase/,
    );
    expect(attachments.put("ws-1", PNG, "image/png").id).not.toBe(chosen);
    attachments.close();
  });

  it("refuses a mime outside the allowlist before storing it", () => {
    const attachments = store();
    expect(() => attachments.put("ws-1", PNG, "image/svg+xml")).toThrow(/SVG is not accepted/);
    expect(() => attachments.put("ws-1", PNG, "text/html")).toThrow(/HTML is not accepted/);
    expect(attachments.usage("ws-1")).toBe(0);
    attachments.close();
  });

  it("collects only the rows the document no longer references", () => {
    const attachments = store();
    const kept = attachments.put("ws-1", PNG, "image/png");
    const dropped = attachments.put("ws-1", new Uint8Array(4), "image/png");
    const other = attachments.put("ws-2", PNG, "image/png");

    expect(gcAttachments("ws-1", [kept.id], attachments)).toBe(1);
    expect(attachments.get(kept.id)).not.toBeNull();
    expect(attachments.get(dropped.id)).toBeNull();
    // Another workspace's bytes are never touched by a workspace's GC.
    expect(attachments.get(other.id)).not.toBeNull();
    expect(attachments.delete(kept.id)).toBe(true);
    expect(attachments.delete(kept.id)).toBe(false);
    attachments.close();
  });

  it("calculates usage across multiple workspaces", () => {
    const attachments = store();
    attachments.put("ws-1", PNG, "image/png");
    attachments.put("ws-2", PNG, "image/png");
    attachments.put("ws-3", PNG, "image/png");

    expect(attachments.usageForWorkspaces(["ws-1", "ws-2"])).toBe(PNG.byteLength * 2);
    expect(attachments.usageForWorkspaces(["ws-1"])).toBe(PNG.byteLength);
    expect(attachments.usageForWorkspaces([])).toBe(0);
    expect(attachments.usageForWorkspaces(["ws-nonexistent"])).toBe(0);
    attachments.close();
  });
});
