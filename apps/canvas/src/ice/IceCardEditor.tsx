/**
 * The one in-place card editor for the ICE desk (ADR-0042).
 *
 * The card a reader double-clicks is mounted as the real `NodeCard` — its Tiptap
 * title and body, bound to the workspace's live Loro containers exactly as the
 * inspector binds them — laid out at the card's world size and scaled with the
 * camera, so it sits over the sheet at the same type size the sheet was drawn at.
 *
 * Two rules this component keeps:
 * - **One editor.** It renders exactly one card, and only the field it was opened
 *   on is editable; the other field is read-only inside the same card face. The
 *   absent containers are created through `WorkspaceDocument` once, because a
 *   field with no container cannot take a caret (the inspector does the same).
 * - **One write route.** Typing goes through `NodeCard`'s Tiptap ↔ Loro binding
 *   (`loro-prosemirror`, the app's only rich-text path); this component never
 *   writes text itself. What it adds is the *settle* signal — a local
 *   `text:title`/`text:body` commit touches the caller's commit window, so the
 *   canvas re-projects the sheet once per pause instead of once per keypress.
 */

import type { CardType, Tag } from "@suite/graph";
import type { LoroDoc } from "loro-crdt";
import { type RefObject, useEffect, useMemo } from "react";
import { cardMeta } from "../cards/cardMeta";
import { resolveCardType, typesById } from "../cards/cardTypes";
import { usePresenceStore } from "../collab/usePresenceStore";
import { NodeCard } from "../components/NodeCard";
import { useCardContainers } from "../hooks/useCardContainers";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useCard, useWorkspaceSnapshot } from "../store/workspaceStore";
import type { IceCardEditingField } from "./iceCardEditor";

export interface IceCardEditorLayerProps {
  /** The card being written in; the layer renders nothing when it is gone. */
  readonly cardId: string;
  /** The Board the placement sits on, for menus and presence scoping. */
  readonly boardId: string;
  /** Which field owns the caret. Switching fields does not remount the card. */
  readonly field: IceCardEditingField;
  /** The card's drawn size in world units: NodeCard's own px layout scale. */
  readonly worldWidth: number;
  readonly worldHeight: number;
  /** The reader switched field by clicking the other one. */
  readonly onFieldChange: (field: IceCardEditingField) => void;
  /** Blur, Escape and a title commit all end the session. */
  readonly onClose: () => void;
  /** One local text commit landed: the caller's commit window should restart. */
  readonly onTextSettled: () => void;
  /** Presence publisher; injected so a test can watch the caret it reports. */
  readonly publishFocus?:
    | ((focus: { readonly nodeId: string; readonly field?: IceCardEditingField } | null) => void)
    | undefined;
}

/** The commit origins the two card editors write under. */
const TEXT_ORIGINS: readonly string[] = ["text:title", "text:body"];

function isTextCommit(origin: string | undefined): boolean {
  return origin !== undefined && TEXT_ORIGINS.includes(origin);
}

export function IceCardEditorLayer({
  cardId,
  boardId,
  field,
  worldWidth,
  worldHeight,
  onFieldChange,
  onClose,
  onTextSettled,
  publishFocus,
}: IceCardEditorLayerProps) {
  const workspace = useCanvasStore((state) => state.workspace);
  const cursorStore = useCanvasStore((state) => state.cursors);
  const localUser = usePresenceStore((state) => state.localUser);
  const openInspector = useUiStore((state) => state.openInspector);
  const canEditContent = useUiStore((state) => state.canEditContent);
  const card = useCard(cardId);
  const snapshot = useWorkspaceSnapshot();
  const containers = useCardContainers(cardId);

  // One index per snapshot identity: a peer editing elsewhere leaves the arrays
  // identical, so these stay cheap across the typing that repaints this card.
  const types = useMemo(() => typesById(snapshot.types), [snapshot.types]);
  const tags = useMemo(
    () => new Map<Tag["id"], Tag>(snapshot.tags.map((tag) => [tag.id, tag])),
    [snapshot.tags],
  );

  // Both editors NodeCard mounts need their own container. A freshly created
  // card has none until the first write, so a seat with content authority asks
  // the document for them once — the same call `useCardPanelModel` makes.
  const titleId = containers.titleId;
  const contentId = containers.contentId;
  useEffect(() => {
    if (!canEditContent) return;
    if (titleId !== null && contentId !== null) return;
    try {
      if (titleId === null) workspace.getTitle(cardId);
      if (contentId === null) workspace.getContent(cardId);
    } catch (error) {
      console.warn("[ice] could not open the card's text", error);
    }
  }, [workspace, cardId, canEditContent, titleId, contentId]);

  // A settle per typing burst, not per keystroke. Only this editor's own origins
  // count: a structural write or a peer's import must not schedule a pass.
  useEffect(() => {
    const subscription = workspace.doc.subscribe((event) => {
      if (event.by !== "local") return;
      if (!isTextCommit(event.origin)) return;
      onTextSettled();
    });
    return () => {
      subscription();
    };
  }, [workspace, onTextSettled]);

  // The caret chip peers draw. Cleared on close, and left alone when the session
  // merely moved to another surface for the same card (the inspector opened).
  useEffect(() => {
    const publish =
      publishFocus ??
      ((focus: { readonly nodeId: string; readonly field?: IceCardEditingField } | null) => {
        usePresenceStore.getState().setFocus(focus);
      });
    publish({ nodeId: cardId, field });
    return () => {
      // The card still has an editor somewhere (the inspector took it over), so
      // that surface owns the caret now; clearing here would blink it off.
      if (useUiStore.getState().editingNodeId === cardId) return;
      publish(null);
    };
  }, [cardId, field, publishFocus]);

  if (card === undefined || titleId === null || contentId === null) return null;

  const type: CardType = resolveCardType(types, card.primaryTypeId);
  const meta = cardMeta(card, types, tags);
  const cardDoc: LoroDoc = workspace.doc;

  return (
    <NodeCard
      card={card}
      type={type}
      meta={meta}
      cardDoc={cardDoc}
      contentId={contentId}
      titleId={titleId}
      cursorStore={cursorStore}
      localUser={localUser}
      boardId={boardId}
      width={worldWidth}
      height={worldHeight}
      editing={field}
      canEditContent={canEditContent}
      // Placement, trash and duplication are the sheet's gestures, not the
      // editor's: those write the document and would make this a second surface.
      canEditLayout={false}
      canManageTrash={false}
      showConnectors={false}
      selected
      onStartEditing={(next) => {
        if (next === field) return;
        onFieldChange(next);
      }}
      onEditEnd={onClose}
      onOpenInfo={() => {
        onClose();
        openInspector(cardId);
      }}
    />
  );
}

export interface IceCardEditorOverlayProps {
  readonly cardId: string;
  readonly boardId: string;
  readonly field: IceCardEditingField;
  /** The card's world box: the page NodeCard lays out in. */
  readonly size: { readonly width: number; readonly height: number };
  /** The slot the frame loop positions, in container CSS px. */
  readonly boxRef: RefObject<HTMLDivElement | null>;
  /** The card's world box, scaled by the camera. */
  readonly pageRef: RefObject<HTMLDivElement | null>;
  /** Escape: the reader is done writing (not "go back a frame"). */
  readonly onEscape: () => void;
  readonly onFieldChange: (field: IceCardEditingField) => void;
  readonly onClose: () => void;
  readonly onTextSettled: () => void;
}

/**
 * The screen-space slot the frame loop positions, with the card's world box
 * inside it. The ground is opaque on purpose: the sheet behind is hidden while
 * the editor is open, so the reader never sees two images of the same words.
 */
export function IceCardEditorOverlay({
  cardId,
  boardId,
  field,
  size,
  boxRef,
  pageRef,
  onEscape,
  onFieldChange,
  onClose,
  onTextSettled,
}: IceCardEditorOverlayProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the card's own ProseMirror editors own the keyboard; this slot only scopes Escape and keeps presses off the desk.
    <div
      ref={boxRef}
      className="ice-card-editor"
      data-testid="ice-card-editor"
      data-card-id={cardId}
      data-field={field}
      data-placed="false"
      // Enter and Escape belong to this editor while it is open, not to the
      // desk's keymap: a claimed target is skipped there, and this handler
      // decides what Escape means.
      data-canvas-keyboard="escape"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onEscape();
      }}
      // A press inside the editor is typing, not a canvas gesture: the desk must
      // not start a marquee or a drag under the caret.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        ref={pageRef}
        className="ice-card-editor__page"
        style={{ width: size.width, height: size.height, transformOrigin: "0 0" }}
      >
        <IceCardEditorLayer
          cardId={cardId}
          boardId={boardId}
          field={field}
          worldWidth={size.width}
          worldHeight={size.height}
          onFieldChange={onFieldChange}
          onClose={onClose}
          onTextSettled={onTextSettled}
        />
      </div>
    </div>
  );
}
