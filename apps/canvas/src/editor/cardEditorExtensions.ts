import { Placeholder } from "@tiptap/extensions";
import type { Extensions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Attachment } from "./attachmentNode";
import { ImageLink } from "./imageLinkNode";
import { ImageUrlPrompt } from "./imageUrlPrompt";
import { Mention } from "./Mention";
import { Media } from "./mediaNode";
import { PropertyBlock } from "./PropertyBlock";
import { PasteImages } from "./pasteImages";
import { SlashCommands } from "./SlashCommands";
import { TourStep } from "./TourStep";
import { Video } from "./videoNode";
import { YouTube } from "./youtubeNode";

export interface CardBodySchemaOptions {
  /** Card that owns the body; mentions and property blocks resolve against it. */
  cardId: string;
  /**
   * Empty-state copy. `null` leaves the decoration out, which is what a
   * read-only surface does; the placeholder contributes no schema.
   */
  placeholder?: string | null;
  /** Opens the card panel from a read-only property block. */
  openPanel?: ((cardId: string) => void) | undefined;
}

/**
 * The node and mark schema of the body editor, without collaboration.
 *
 * `CardBodyEditor` appends `LoroCollaboration`, which contributes plugins and
 * keyboard shortcuts but no nodes or marks. Keeping the schema here lets
 * `editorSchemaContract.test.ts` instantiate the same schema as the app and
 * compare it with the publish allowlist.
 */
export function cardBodySchemaExtensions({
  cardId,
  placeholder = null,
  openPanel,
}: CardBodySchemaOptions): Extensions {
  return [
    // Collaboration ships its own undo history, so StarterKit's is disabled.
    StarterKit.configure({ undoRedo: false }),
    // Both editors share the extension's one `@` suggestion config; the
    // owner id is what adds this card's fields to the picker.
    Mention.configure({ cardId }),
    SlashCommands,
    // The `/` menu's image row asks for a URL here: a widget inside the editor,
    // so the caret and the editing session survive the answer.
    ImageUrlPrompt,
    // Images are nodes that name their bytes by id; the bytes live beside the
    // document, so a share projection copies metadata only.
    Attachment,
    // Attached video bytes beside the document.
    Video,
    // YouTube video embed via privacy-preserving iframe.
    YouTube,
    // A link image names a URL and holds no bytes, so it works in every
    // edition, including a standalone build with no relay at all.
    ImageLink,
    // One media block: the only thing new content writes. The four above stay
    // registered so documents that predate it keep rendering, and
    // `migrateLegacyMedia` converts one to this the first time its body is edited.
    Media,
    PasteImages,
    PropertyBlock.configure({
      cardId,
      openPanel: (id: string) => openPanel?.(id),
    }),
    // A tour step is a block in the tutorial's body, so the card that owns the
    // body is what "present from this step" plays (ADR-0054).
    TourStep.configure({ cardId }),
    // An empty body still reads as a place to write, unless the reader has
    // no way to write there. The decoration is render-only: it never
    // touches the CRDT and leaves carets alone.
    ...(placeholder
      ? [
          Placeholder.configure({
            placeholder,
            showOnlyWhenEditable: false,
          }),
        ]
      : []),
  ];
}
