import type { DrawingElement } from "@suite/graph";
import { describe, expect, it } from "vitest";
import {
  bytesFromDataUrl,
  sketchAttachmentId,
  sketchFileRefs,
  sketchFileUrl,
  withSketchFile,
} from "./sketchFiles";

const ID = "a".repeat(32);

function imageElement(overrides: Record<string, unknown> = {}): DrawingElement {
  return {
    id: "img-1",
    type: "image",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    fileId: "excalidraw-file",
    ...overrides,
  } as unknown as DrawingElement;
}

describe("sketch pictures", () => {
  it("should read the attachment a stored image points at", () => {
    expect(sketchAttachmentId(imageElement())).toBeNull();
    expect(sketchAttachmentId(imageElement({ customData: { suiteFile: { id: ID } } }))).toBe(ID);
    // Anything that is not an attachment id is not the mapping, so a hand-edited
    // document cannot make the surface request an arbitrary path.
    expect(
      sketchAttachmentId(imageElement({ customData: { suiteFile: { id: "../etc/passwd" } } })),
    ).toBeNull();
  });

  it("should list one ref per fileId and skip what is still uploading", () => {
    const refs = sketchFileRefs([
      imageElement({ customData: { suiteFile: { id: ID } } }),
      imageElement({ id: "img-2", customData: { suiteFile: { id: ID } } }),
      imageElement({ id: "img-3", fileId: "pending-file" }),
      // A freedraw element has no file at all.
      { id: "stroke", type: "freedraw", x: 0, y: 0, width: 1, height: 1 },
    ]);

    expect(refs).toEqual([{ fileId: "excalidraw-file", attachmentId: ID }]);
  });

  it("should record the id on the element that owns the file, leaving others alone", () => {
    const element = imageElement();
    const stamped = withSketchFile(element, "excalidraw-file", ID);

    expect(stamped.customData).toEqual({ suiteFile: { id: ID } });
    // The original is untouched: it is Excalidraw's own object.
    expect(element.customData).toBeUndefined();
    expect(withSketchFile(element, "another-file", ID)).toBe(element);
  });

  it("should keep custom data it did not write", () => {
    const stamped = withSketchFile(
      imageElement({ customData: { source: "pages" } }),
      "excalidraw-file",
      ID,
    );

    expect(stamped.customData).toEqual({ source: "pages", suiteFile: { id: ID } });
  });

  it("should name the relay route the bytes are read from", () => {
    expect(sketchFileUrl(ID)).toContain(`/api/attachments/${ID}`);
  });

  it("should decode a base64 data URL and refuse anything else", () => {
    // "hi" in base64: the round trip is what the upload relies on.
    expect(Array.from(bytesFromDataUrl("data:image/png;base64,aGk=") ?? [])).toEqual([104, 105]);
    expect(bytesFromDataUrl("data:image/png,raw")).toBeNull();
    expect(bytesFromDataUrl("not a url")).toBeNull();
    expect(bytesFromDataUrl("data:image/png;base64,!!!!")).toBeNull();
  });
});
