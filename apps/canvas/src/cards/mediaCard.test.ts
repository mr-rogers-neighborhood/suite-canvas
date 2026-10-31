import { documentMedia, WorkspaceDocument, type WorkspaceMediaItem } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { createMediaCard, ensureMediaType, MEDIA_TYPE_ID, mediaBodyNode } from "./mediaCard";

const ID = "0123456789abcdef0123456789abcdef";

function item(overrides: Partial<WorkspaceMediaItem> = {}): WorkspaceMediaItem {
  return {
    id: ID,
    kind: "image",
    url: null,
    mime: "image/png",
    name: "beach.png",
    width: 800,
    height: 600,
    bytes: 1234,
    duration: null,
    videoId: null,
    cards: [],
    ...overrides,
  };
}

describe("the media type", () => {
  it("should be created once and reused", () => {
    const workspace = new WorkspaceDocument();

    const first = ensureMediaType(workspace);
    const second = ensureMediaType(workspace);

    expect(first.id).toBe(MEDIA_TYPE_ID);
    expect(second.id).toBe(first.id);
    expect(workspace.listTypes().filter((type) => type.id === MEDIA_TYPE_ID)).toHaveLength(1);
  });
});

describe("a media card's body", () => {
  it("should reference a stored image by id rather than copy it", () => {
    expect(mediaBodyNode(item())).toEqual({
      type: "media",
      attrs: {
        kind: "image",
        id: ID,
        mime: "image/png",
        name: "beach.png",
        width: 800,
        height: 600,
        bytes: 1234,
      },
    });
  });

  it("should keep a video a video", () => {
    expect(mediaBodyNode(item({ kind: "video", mime: "video/mp4" }))).toMatchObject({
      attrs: { kind: "video", id: ID },
    });
  });

  it("should key an embed by its video id", () => {
    expect(
      mediaBodyNode(
        item({ kind: "youtube", id: "yt_dQw4w9WgXcQ", mime: null, videoId: "dQw4w9WgXcQ" }),
      ),
    ).toMatchObject({ attrs: { kind: "youtube", videoId: "dQw4w9WgXcQ", title: "beach.png" } });
  });

  it("should keep a link image's address", () => {
    expect(
      mediaBodyNode(item({ id: "https://cdn.example.com/a.png", mime: null, url: null })),
    ).toMatchObject({ attrs: { kind: "image", src: "https://cdn.example.com/a.png" } });
  });
});

describe("creating a media card", () => {
  it("should hold the item and start in the Inbox, on no board", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    workspace.ensureBoard();

    const card = createMediaCard(workspace, item());

    expect(card.primaryTypeId).toBe(MEDIA_TYPE_ID);
    // Unplaced on purpose: the reader chooses where it goes.
    expect(workspace.listCardPlacements(card.id)).toEqual([]);
    expect(workspace.listBoardCards(workspace.listBoards()[0]?.id ?? "")).toEqual([]);
  });

  it("should make the media visible to the library it came from", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const card = createMediaCard(workspace, item());

    const found = documentMedia(workspace).find((entry) => entry.id === ID);
    expect(found?.cards.map((entry) => entry.id)).toContain(card.id);
  });
});
