import { useReactFlow, type Viewport } from "@xyflow/react";
import { useCallback, useEffect, useRef } from "react";
import { prefersReducedMotion } from "../canvas/localEasing";
import { isShareSession } from "../session/session";
import { useUiStore } from "../store/useUiStore";
import { CardFocusSurface } from "./CardFocusSurface";
import { CardPanel } from "./CardPanel";
import { useCardPanelModel } from "./useCardPanelModel";

/** How long the surface waits for the body editor to mount before giving up. */
const FOCUS_RETRY_FRAMES = 60;

/**
 * The card-focus mode: the inspector's Edit action and a double-click on a
 * non-portal card both land here. It expands over the canvas area, keeps the
 * app chrome, edits the same card object through the same `CardPanel`, and puts
 * the viewport back where it was when the surface closes.
 */
export function CardFocusHost() {
  const cardFocusId = useUiStore((state) => state.cardFocusId);
  const closeCardFocus = useUiStore((state) => state.closeCardFocus);
  const editingNodeId = useUiStore((state) => state.editingNodeId);
  const editingField = useUiStore((state) => state.editingField);
  const editingSurface = useUiStore((state) => state.editingSurface);
  const startEditing = useUiStore((state) => state.startEditing);
  const readOnly = useUiStore((state) => state.readOnly);
  const canEditContent = useUiStore((state) => state.canEditContent);
  const canEditLayout = useUiStore((state) => state.canEditLayout);
  const canManageSchema = useUiStore((state) => state.canManageSchema);

  const model = useCardPanelModel(cardFocusId, "focus");
  const { getViewport, setViewport } = useReactFlow();
  const savedViewport = useRef<Viewport | null>(null);
  const cardId = model?.card.id ?? null;

  // The board is never moved underneath the surface, so closing it can restore
  // the exact camera the reader came from — including after a pan behind it.
  useEffect(() => {
    if (!cardId) return;
    savedViewport.current = getViewport();
    return () => {
      const saved = savedViewport.current;
      savedViewport.current = null;
      if (saved) void setViewport(saved, { duration: 0 });
    };
  }, [cardId, getViewport, setViewport]);

  // Focus is an editing gesture: the body editor takes the caret as soon as the
  // panel has mounted it, and the title/body stay the panel's editors.
  useEffect(() => {
    if (!cardId) return;
    startEditing(cardId, "body", "focus");
    let frame = 0;
    let tries = 0;
    const focusBody = () => {
      const editor = document.querySelector<HTMLElement>('[data-testid="card-focus"] .ProseMirror');
      if (editor) {
        editor.focus();
        return;
      }
      if (tries >= FOCUS_RETRY_FRAMES) return;
      tries += 1;
      frame = requestAnimationFrame(focusBody);
    };
    frame = requestAnimationFrame(focusBody);
    return () => cancelAnimationFrame(frame);
  }, [cardId, startEditing]);

  // The zoom trick: the sheet grows out of the card's own rectangle, the same
  // way a portal grows its target board. The card is still mounted under the
  // surface, so its rect is read from the DOM instead of threaded through state.
  useEffect(() => {
    if (!cardId) return;
    const sheet = document.querySelector<HTMLElement>(".card-focus__sheet");
    if (!sheet || typeof sheet.animate !== "function" || prefersReducedMotion()) return;
    const card = document.querySelector<HTMLElement>(
      `[data-testid="node-card"][data-node-id="${cardId}"]`,
    );
    const from = card?.getBoundingClientRect();
    if (!from || from.width === 0) return;
    const to = sheet.getBoundingClientRect();
    const dx = from.x + from.width / 2 - (to.x + to.width / 2);
    const dy = from.y + from.height / 2 - (to.y + to.height / 2);
    const scale = Math.max(0.12, Math.min(1, from.width / to.width));
    const animation = sheet.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.4 },
        { transform: "translate(0, 0) scale(1)", opacity: 1 },
      ],
      { duration: 260, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
    );
    return () => animation.cancel();
  }, [cardId]);

  const close = useCallback(() => closeCardFocus(), [closeCardFocus]);

  if (!model) return null;

  const focusEditing =
    editingNodeId === model.card.id && editingSurface === "focus" ? editingField : null;

  return (
    <CardFocusSurface title={model.title} onClose={close}>
      <CardPanel
        card={model.card}
        title={model.title}
        types={model.types}
        tags={model.tags}
        boards={model.boards}
        fields={model.fields}
        where={model.where}
        cards={model.cards}
        links={model.links}
        variant="inspector"
        bodyEmpty={model.bodyEmpty}
        editing={focusEditing}
        cardDoc={model.cardDoc}
        contentId={model.contentId}
        titleId={model.titleId}
        cursorStore={model.cursorStore}
        localUser={model.localUser}
        peers={model.peers}
        onStartEditing={model.onStartEditing}
        onEditEnd={model.onEditEnd}
        onSetType={model.onSetType}
        onAddTag={model.onAddTag}
        onRemoveTag={model.onRemoveTag}
        onCreateTag={model.onCreateTag}
        onSetProperty={model.onSetProperty}
        onClearProperty={model.onClearProperty}
        onOpenCardPanel={model.onOpenCardPanel}
        onManageTypes={model.onManageTypes}
        onFocusCard={model.onFocusCard}
        onFocusSection={model.onFocusSection}
        onRemoveFromBoard={model.onRemoveFromBoard}
        onFocusLink={model.onFocusLink}
        readOnly={readOnly}
        canEditContent={canEditContent}
        canEditLayout={canEditLayout}
        canManageSchema={canManageSchema}
        restrictLinks={isShareSession()}
      />
    </CardFocusSurface>
  );
}
