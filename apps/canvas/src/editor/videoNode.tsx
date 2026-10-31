import { mergeAttributes, Node, ReactNodeViewRenderer } from "@tiptap/react";
import { attachmentUrl } from "./attachmentNode";
import { VideoView } from "./VideoView";

export const VIDEO_NODE_NAME = "video";

export const Video = Node.create({
  name: VIDEO_NODE_NAME,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    const attribute = (name: string, dataName: string) => ({
      default: null,
      parseHTML: (element: HTMLElement) => {
        const value = element.getAttribute(dataName);
        if (value === null) return null;
        if (name === "width" || name === "height" || name === "bytes" || name === "duration") {
          const number = Number(value);
          return Number.isFinite(number) && number >= 0 ? number : null;
        }
        return value;
      },
      renderHTML: (attributes: Record<string, unknown>) => {
        const value = attributes[name];
        return value === null || value === undefined ? {} : { [dataName]: String(value) };
      },
    });

    return {
      id: attribute("id", "data-attachment-id"),
      mime: attribute("mime", "data-attachment-mime"),
      width: attribute("width", "data-attachment-width"),
      height: attribute("height", "data-attachment-height"),
      name: attribute("name", "data-attachment-name"),
      bytes: attribute("bytes", "data-attachment-bytes"),
      duration: attribute("duration", "data-attachment-duration"),
    };
  },

  parseHTML() {
    return [{ tag: "video[data-attachment-id]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const id = typeof node.attrs.id === "string" ? node.attrs.id : "";
    return [
      "video",
      mergeAttributes(
        {
          "data-attachment-id": id,
          src: id.length > 0 ? attachmentUrl(id) : null,
          controls: "true",
        },
        HTMLAttributes,
      ),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoView);
  },
});
