import type { Editor } from "@tiptap/react";
import { canUploadMedia } from "../auth/mediaUploadGating";
import { announceUploadRefusal } from "../auth/uploadRefusal";
import { MEDIA_NODE_NAME } from "./mediaNode";
import { insertMediaFiles } from "./pasteImages";
import { parseYouTubeVideoId } from "./youtubeNode";

/**
 * Triggers a native file picker for images.
 */
export function uploadImageFile(editor: Editor): void {
  const permission = canUploadMedia();
  if (!permission.allowed) {
    announceUploadRefusal(permission);
    return;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/gif,image/webp,image/avif";
  input.multiple = true;
  input.style.display = "none";
  input.onchange = () => {
    if (input.files && input.files.length > 0) {
      void insertMediaFiles(editor.view, Array.from(input.files));
    }
    input.remove();
  };
  document.body.appendChild(input);
  input.click();
}

/**
 * Triggers a native file picker for videos.
 */
export function uploadVideoFile(editor: Editor): void {
  const permission = canUploadMedia();
  if (!permission.allowed) {
    announceUploadRefusal(permission);
    return;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "video/mp4,video/webm,video/ogg,video/quicktime";
  input.multiple = true;
  input.style.display = "none";
  input.onchange = () => {
    if (input.files && input.files.length > 0) {
      void insertMediaFiles(editor.view, Array.from(input.files));
    }
    input.remove();
  };
  document.body.appendChild(input);
  input.click();
}

/**
 * Prompts for a YouTube URL and embeds the video.
 */
export function promptYouTubeEmbed(editor: Editor): void {
  const url = window.prompt(
    "Enter a YouTube video URL (e.g. https://www.youtube.com/watch?v=...):",
  );
  if (!url) return;
  const videoId = parseYouTubeVideoId(url);
  if (!videoId) {
    alert("Could not extract a valid YouTube video ID from that link.");
    return;
  }
  editor
    .chain()
    .focus()
    .insertContent({
      type: MEDIA_NODE_NAME,
      attrs: {
        kind: "youtube",
        videoId,
        src: `https://www.youtube-nocookie.com/embed/${videoId}`,
        title: "YouTube video",
      },
    })
    .run();
}

/**
 * Triggers a native file picker for a book.
 *
 * One file, `.epub` only. A book is the one media kind whose bytes are also the thing the app reads rather than
 * draws, so a file that is not an EPUB is refused by the picker rather than accepted and then refused by the
 * reader.
 */
export function uploadBookFile(editor: Editor): void {
  const permission = canUploadMedia();
  if (!permission.allowed) {
    announceUploadRefusal(permission);
    return;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/epub+zip,.epub";
  input.multiple = false;
  input.style.display = "none";
  input.onchange = () => {
    const file = input.files?.[0];
    if (file !== undefined) void insertMediaFiles(editor.view, [file]);
    input.remove();
  };
  document.body.appendChild(input);
  input.click();
}
