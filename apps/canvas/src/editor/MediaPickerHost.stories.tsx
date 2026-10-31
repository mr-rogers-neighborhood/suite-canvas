import type { Meta, StoryObj } from "@storybook/react-vite";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";
import { MediaPickerHost } from "./MediaPickerHost";
import { useMediaPicker } from "./mediaPicker";

/**
 * The picker is driven by the store rather than props, so the story opens it the
 * way the `/` menu does: with an editor to answer against.
 */
function OpenPicker() {
  useEffect(() => {
    const editor = new Editor({
      extensions: [StarterKit.configure({ undoRedo: false })],
      content: "",
    });
    useMediaPicker.getState().openPicker(editor);
    return () => {
      useMediaPicker.getState().closePicker();
      editor.destroy();
    };
  }, []);

  return <MediaPickerHost />;
}

const meta = {
  title: "Editor/MediaPicker",
  component: MediaPickerHost,
  parameters: { layout: "fullscreen" },
  render: () => <OpenPicker />,
  tags: ["autodocs"],
} satisfies Meta<typeof MediaPickerHost>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The one surface that answers "which kind of media" for `/` and the toolbar. */
export const Open: Story = {};
