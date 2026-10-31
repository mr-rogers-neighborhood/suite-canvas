import type { Editor } from "@tiptap/react";
import { canUploadMedia } from "../auth/mediaUploadGating";
import { insertMediaFiles } from "./pasteImages";
import { parseYouTubeVideoId } from "./youtubeNode";

/**
 * Triggers a native file picker for images.
 */
export function uploadImageFile(editor: Editor): void {
  const permission = canUploadMedia();
  if (!permission.allowed) {
    alert(permission.reason ?? "Uploads require an upgraded plan.");
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
    alert(permission.reason ?? "Uploads require an upgraded plan.");
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
      type: "youtube",
      attrs: {
        videoId,
        src: `https://www.youtube-nocookie.com/embed/${videoId}`,
        title: "YouTube video",
      },
    })
    .run();
}
