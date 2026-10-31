import type { Editor } from "@tiptap/react";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../dialogs/useFocusTrap";
import { useEscapeLayer } from "../shell/escapeLayers";
import { openImageUrlPrompt } from "./imageUrlPrompt";
import { promptYouTubeEmbed, uploadImageFile, uploadVideoFile } from "./mediaFileUpload";
import { useMediaPicker } from "./mediaPicker";

interface MediaChoice {
  id: string;
  title: string;
  hint: string;
  glyph: string;
  run: (editor: Editor) => void;
}

/**
 * What `/media` and the toolbar's Media button offer, in one table.
 *
 * Four ways in, one idea out: the reader asked for media, and the type of media
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
    run: (editor) => uploadImageFile(editor),
  },
  {
    id: "video",
    title: "Video",
    hint: "Upload a video from your device",
    glyph: "\u{1f3ac}",
    run: (editor) => uploadVideoFile(editor),
  },
  {
    id: "youtube",
    title: "YouTube",
    // "External" is the word that separates this from `embed`, which shows a card
    // from this workspace. The two live one menu apart, so they have to read apart.
    hint: "Embed an external video by link",
    glyph: "\u25b6",
    run: (editor) => promptYouTubeEmbed(editor),
  },
  {
    id: "link",
    title: "Image link",
    hint: "Embed an external picture by URL, with no upload",
    glyph: "\u{1f517}",
    run: (editor) => openImageUrlPrompt(editor),
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
  const editor = useMediaPicker((state) => state.editor);
  const closePicker = useMediaPicker((state) => state.closePicker);
  const panel = useRef<HTMLDivElement | null>(null);

  useEscapeLayer(closePicker, open);
  useFocusTrap(panel, open);

  if (!open || !editor) return null;

  const choose = (choice: MediaChoice) => {
    choice.run(editor);
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
