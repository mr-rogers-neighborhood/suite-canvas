import { mergeAttributes, Node, ReactNodeViewRenderer } from "@tiptap/react";
import { YouTubeView } from "./YouTubeView";

export const YOUTUBE_NODE_NAME = "youtube";

/**
 * Extracts an 11-character YouTube video ID from various URL patterns:
 * - standard: https://www.youtube.com/watch?v=VIDEO_ID
 * - short: https://youtu.be/VIDEO_ID
 * - embed: https://www.youtube.com/embed/VIDEO_ID
 * - privacy: https://www.youtube-nocookie.com/embed/VIDEO_ID
 * - shorts: https://www.youtube.com/shorts/VIDEO_ID
 * - plain ID: VIDEO_ID
 */
export function parseYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/u.test(trimmed)) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    const host = url.hostname.replace(/^www\./u, "").replace(/^m\./u, "");
    if (host === "youtu.be") {
      const id = url.pathname.slice(1).split("/")[0] ?? "";
      return /^[a-zA-Z0-9_-]{11}$/u.test(id) ? id : null;
    }
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (url.pathname.startsWith("/watch")) {
        const id = url.searchParams.get("v") ?? "";
        return /^[a-zA-Z0-9_-]{11}$/u.test(id) ? id : null;
      }
      if (url.pathname.startsWith("/embed/") || url.pathname.startsWith("/shorts/")) {
        const id = url.pathname.split("/")[2] ?? "";
        return /^[a-zA-Z0-9_-]{11}$/u.test(id) ? id : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export const YouTube = Node.create({
  name: YOUTUBE_NODE_NAME,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      videoId: {
        default: null,
        parseHTML: (el) =>
          el.getAttribute("data-youtube-video") ?? el.getAttribute("data-video-id"),
        renderHTML: (attrs) => (attrs.videoId ? { "data-youtube-video": attrs.videoId } : {}),
      },
      src: {
        default: null,
        parseHTML: (el) => el.getAttribute("src"),
        renderHTML: (attrs) => (attrs.src ? { src: attrs.src } : {}),
      },
      title: {
        default: null,
        parseHTML: (el) => el.getAttribute("title"),
        renderHTML: (attrs) => (attrs.title ? { title: attrs.title } : {}),
      },
      width: {
        default: null,
        parseHTML: (el) => {
          const val = Number(el.getAttribute("width"));
          return Number.isFinite(val) && val > 0 ? val : null;
        },
        renderHTML: (attrs) => (attrs.width ? { width: String(attrs.width) } : {}),
      },
      height: {
        default: null,
        parseHTML: (el) => {
          const val = Number(el.getAttribute("height"));
          return Number.isFinite(val) && val > 0 ? val : null;
        },
        renderHTML: (attrs) => (attrs.height ? { height: String(attrs.height) } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-youtube-video]" }, { tag: "iframe[src*='youtube']" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const videoId = typeof node.attrs.videoId === "string" ? node.attrs.videoId : "";
    const src =
      typeof node.attrs.src === "string" && node.attrs.src.length > 0
        ? node.attrs.src
        : `https://www.youtube-nocookie.com/embed/${videoId}`;
    return [
      "div",
      mergeAttributes({ "data-youtube-video": videoId }, HTMLAttributes),
      [
        "iframe",
        {
          src,
          title: node.attrs.title || "YouTube video",
          frameborder: "0",
          allow:
            "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
          allowfullscreen: "true",
          style: "width: 100%; aspect-ratio: 16/9; border-radius: 8px;",
        },
      ],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(YouTubeView);
  },
});
