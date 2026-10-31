import { fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaPickerHost } from "./MediaPickerHost";
import { useMediaPicker } from "./mediaPicker";

const uploadImageFile = vi.fn();
const uploadVideoFile = vi.fn();
const promptYouTubeEmbed = vi.fn();
const openImageUrlPrompt = vi.fn();

vi.mock("./mediaFileUpload", () => ({
  uploadImageFile: (editor: Editor) => uploadImageFile(editor),
  uploadVideoFile: (editor: Editor) => uploadVideoFile(editor),
  promptYouTubeEmbed: (editor: Editor) => promptYouTubeEmbed(editor),
}));

vi.mock("./imageUrlPrompt", () => ({
  openImageUrlPrompt: (editor: Editor) => openImageUrlPrompt(editor),
}));

let editor: Editor | null = null;

beforeEach(() => {
  editor = new Editor({ extensions: [StarterKit.configure({ undoRedo: false })], content: "" });
});

afterEach(() => {
  editor?.destroy();
  editor = null;
  useMediaPicker.getState().closePicker();
  vi.clearAllMocks();
});

function open(): Editor {
  const instance = editor as Editor;
  useMediaPicker.getState().openPicker(instance);
  return instance;
}

describe("the media picker", () => {
  it("should offer every kind of media in one list", () => {
    open();
    render(<MediaPickerHost />);

    expect(screen.getByRole("dialog", { name: "Add media" })).toBeInTheDocument();
    expect(screen.getByTestId("media-choice-image")).toBeInTheDocument();
    expect(screen.getByTestId("media-choice-video")).toBeInTheDocument();
    expect(screen.getByTestId("media-choice-youtube")).toBeInTheDocument();
    expect(screen.getByTestId("media-choice-link")).toBeInTheDocument();
  });

  it("should hand the choice to the helper that owns that insert path", () => {
    const instance = open();
    render(<MediaPickerHost />);

    fireEvent.click(screen.getByTestId("media-choice-youtube"));

    expect(promptYouTubeEmbed).toHaveBeenCalledWith(instance);
    expect(uploadImageFile).not.toHaveBeenCalled();
  });

  it("should close once the choice is made", () => {
    open();
    render(<MediaPickerHost />);

    fireEvent.click(screen.getByTestId("media-choice-image"));

    expect(uploadImageFile).toHaveBeenCalledTimes(1);
    expect(useMediaPicker.getState().open).toBe(false);
  });

  it("should draw nothing until it is asked for", () => {
    render(<MediaPickerHost />);
    expect(screen.queryByRole("dialog", { name: "Add media" })).toBeNull();
  });
});
