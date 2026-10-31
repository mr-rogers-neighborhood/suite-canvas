import type { WorkspaceMediaItem } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LibraryMediaList } from "./LibraryMediaList";

const MOCK_ITEMS: WorkspaceMediaItem[] = [
  {
    id: "att_image_1",
    kind: "image",
    url: "https://example.com/cat.png",
    mime: "image/png",
    name: "Cat Photo",
    width: 800,
    height: 600,
    bytes: 1024 * 50,
    duration: null,
    videoId: null,
    cards: [{ id: "c1", title: "Pets Card" }],
  },
  {
    id: "att_video_1",
    kind: "video",
    url: null,
    mime: "video/mp4",
    name: "Demo Video",
    width: 1920,
    height: 1080,
    bytes: 1024 * 1024 * 5,
    duration: 60,
    videoId: null,
    cards: [{ id: "c2", title: "Walkthrough" }],
  },
  {
    id: "yt_dQw4w9WgXcQ",
    kind: "youtube",
    url: null,
    mime: null,
    name: "Rickroll",
    width: null,
    height: null,
    bytes: null,
    duration: null,
    videoId: "dQw4w9WgXcQ",
    cards: [{ id: "c3", title: "Music" }],
  },
];

describe("LibraryMediaList", () => {
  it("renders empty state when no items exist", () => {
    render(<LibraryMediaList items={[]} />);
    expect(screen.getByText("No media in this workspace yet.")).toBeDefined();
  });

  it("renders media cards and filtering chips", () => {
    render(<LibraryMediaList items={MOCK_ITEMS} />);
    expect(screen.getByText("Cat Photo")).toBeDefined();
    expect(screen.getByText("Demo Video")).toBeDefined();
    expect(screen.getByText("Rickroll")).toBeDefined();
  });

  it("filters items by kind chip", () => {
    render(<LibraryMediaList items={MOCK_ITEMS} />);
    const videoFilter = screen.getByTestId("media-filter-video");
    fireEvent.click(videoFilter);

    expect(screen.queryByText("Cat Photo")).toBeNull();
    expect(screen.getByText("Demo Video")).toBeDefined();
    expect(screen.queryByText("Rickroll")).toBeNull();
  });

  it("filters items by search query", () => {
    render(<LibraryMediaList items={MOCK_ITEMS} />);
    const searchInput = screen.getByTestId("library-media-search");
    fireEvent.change(searchInput, { target: { value: "Walkthrough" } });

    expect(screen.queryByText("Cat Photo")).toBeNull();
    expect(screen.getByText("Demo Video")).toBeDefined();
  });

  it("invokes onTrash when trash button is clicked", () => {
    const onTrash = vi.fn();
    render(<LibraryMediaList items={MOCK_ITEMS} onTrash={onTrash} canManage />);
    const trashBtn = screen.getByTestId("trash-media-att_image_1");
    fireEvent.click(trashBtn);
    expect(onTrash).toHaveBeenCalledWith("att_image_1");
  });
});
