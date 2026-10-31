import { useRef } from "react";
import { createPortal } from "react-dom";
import { ensureMediaType, MEDIA_TYPE_ID } from "../cards/mediaCard";
import { useFocusTrap } from "../dialogs/useFocusTrap";
import { useEscapeLayer } from "../shell/escapeLayers";
import { useCanvasStore } from "../store/useCanvasStore";
import { openImageUrlPrompt } from "./imageUrlPrompt";
import { insertMediaNode, type MediaAttrs } from "./mediaNode";
import { type MediaTarget, useMediaPicker } from "./mediaPicker";
import { prepareMediaFile } from "./pasteImages";
import { parseYouTubeVideoId } from "./youtubeNode";

interface MediaChoice {
  id: string;
  title: string;
  hint: string;
  glyph: string;
  /** The answer, applied wherever the target says it lands. */
  run: (target: MediaTarget) => void;
}

/**
 * Put one block where the reader asked.
 *
 * At a caret it is an insert; on the board it is a card of the media type at the click, holding the block — the
 * same shape `createMediaCard` writes for the library, so a book made from the menu and a book placed from the
 * library are the same card.
 */
function placeBlock(target: MediaTarget, attrs: MediaAttrs): void {
  if (target.kind === "editor") {
    insertMediaNode(target.editor.view, attrs);
    return;
  }
  const workspace = useCanvasStore.getState().workspace;
  if (workspace === null) return;
  ensureMediaType(workspace);
  const card = workspace.createCard({
    typeId: MEDIA_TYPE_ID,
    boardId: target.boardId,
    position: target.position,
  });
  workspace.setBodyNodes(card.id, [{ type: "media", attrs }]);
  useCanvasStore.getState();
}

/** Ask for files, then place what comes back. The dialog has to open inside the click that asked for it. */
function pickFiles(
  target: MediaTarget,
  accept: string,
  multiple: boolean,
  fallbackName: string,
): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.multiple = multiple;
  input.style.display = "none";
  input.onchange = () => {
    const files = [...(input.files ?? [])];
    input.remove();
    void (async () => {
      for (const file of files) {
        const attrs = await prepareMediaFile(file, { fallbackName });
        if (attrs !== null) placeBlock(target, attrs);
      }
    })();
  };
  document.body.appendChild(input);
  input.click();
}

/**
 * What `/media` and the toolbar's Media button offer, in one table.
 *
 * Five ways in, one idea out: the reader asked for media, and the type of media
 * is the question being answered. Keeping them in one list means the two
 * surfaces that open this picker cannot drift, the way the `/` menu and the
 * toolbar once did.
 *
 * Every row hands off to a helper the editor already had. This dialog decides
 * *which* one; it never builds a node itself, so there is exactly one insert
 * path per kind.
 */
export const MEDIA_CHOICES: readonly MediaChoice[] = [
  {
    id: "image",
    title: "Image",
    hint: "Upload a picture from your device",
    glyph: "\u{1f5bc}",
    run: (target) =>
      pickFiles(
        target,
        "image/png,image/jpeg,image/gif,image/webp,image/avif",
        true,
        "Pasted image",
      ),
  },
  {
    id: "video",
    title: "Video",
    hint: "Upload a video from your device",
    glyph: "\u{1f3ac}",
    run: (target) =>
      pickFiles(target, "video/mp4,video/webm,video/ogg,video/quicktime", true, "Attached video"),
  },
  {
    id: "book",
    title: "Book",
    hint: "Upload an .epub and read it on the board",
    glyph: "\u{1f4d6}",
    run: (target) => pickFiles(target, "application/epub+zip,.epub", false, "Untitled book"),
  },
  {
    id: "youtube",
    title: "YouTube",
    // "External" is the word that separates this from `embed`, which shows a card
    // from this workspace. The two live one menu apart, so they have to read apart.
    hint: "Embed an external video by link",
    glyph: "\u25b6",
    run: (target) => {
      const url = window.prompt(
        "Enter a YouTube video URL (e.g. https://www.youtube.com/watch?v=...)",
      );
      if (!url) return;
      const videoId = parseYouTubeVideoId(url);
      if (!videoId) {
        window.alert("Could not extract a valid YouTube video ID from that link.");
        return;
      }
      placeBlock(target, {
        kind: "youtube",
        videoId,
        src: `https://www.youtube-nocookie.com/embed/${videoId}`,
        title: "YouTube video",
      });
    },
  },
  {
    id: "link",
    title: "Image link",
    hint: "Embed an external picture by URL, with no upload",
    glyph: "\u{1f517}",
    run: (target) => {
      // A URL needs a caret to answer at. On the board there is none, so the prompt is the browser's, which is the
      // honest difference between the two targets rather than a second dialog that pretends otherwise.
      if (target.kind === "editor") {
        openImageUrlPrompt(target.editor);
        return;
      }
      const url = window.prompt("Image URL (https://…)");
      if (!url) return;
      placeBlock(target, { kind: "image", src: url, alt: "Linked image" });
    },
  },
];

/**
 * The one place a media type is chosen.
 *
 * Rendered once for the shell and driven by `useMediaPicker`, so the `/` menu,
 * the toolbar and any later entry point all reach the same dialog. The action
 * runs before the dialog closes: three of the four open a native picker or a
 * prompt, which the browser only allows from inside the click that asked.
 */
export function MediaPickerHost() {
  const open = useMediaPicker((state) => state.open);
  const target = useMediaPicker((state) => state.target);
  const closePicker = useMediaPicker((state) => state.closePicker);
  const panel = useRef<HTMLDivElement | null>(null);

  useEscapeLayer(closePicker, open);
  useFocusTrap(panel, open);

  if (!open || target === null) return null;

  const choose = (choice: MediaChoice) => {
    choice.run(target);
    closePicker();
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <button
        type="button"
        aria-label="Close media picker"
        className="absolute inset-0 cursor-default border-0 bg-black/25 backdrop-blur-[2px]"
        onClick={closePicker}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Add media"
        tabIndex={-1}
        data-testid="media-picker"
        className="relative w-[min(360px,calc(100vw-2rem))] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-2 shadow-xl outline-none"
      >
        <p className="px-2 pt-1 pb-2 text-xs font-semibold text-[var(--ink-muted)]">Add media</p>
        <ul className="flex flex-col gap-0.5">
          {MEDIA_CHOICES.map((choice) => (
            <li key={choice.id}>
              <button
                type="button"
                data-testid={`media-choice-${choice.id}`}
                onClick={() => choose(choice)}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
              >
                <span aria-hidden="true" className="w-4 shrink-0 text-center text-sm">
                  {choice.glyph}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-[var(--ink)]">
                    {choice.title}
                  </span>
                  <span className="block text-[11px] leading-snug text-[var(--ink-muted)]">
                    {choice.hint}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
