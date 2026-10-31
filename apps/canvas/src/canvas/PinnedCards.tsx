import { useCallback, useEffect, useState } from "react";
import { CardBodyEditor } from "../cards/CardBodyEditor";
import { StaticCardTitle } from "../cards/StaticCardFace";
import { usePresenceStore } from "../collab/usePresenceStore";
import { type PinRect, usePinStore } from "../store/pinStore";
import { useCanvasStore } from "../store/useCanvasStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { useFloatGesture } from "./floatGesture";
import { planFloats } from "./floatPlan";
import { shellBounds, shellObstacles } from "./shellObstacles";

/**
 * The cards a reader pinned to the shell.
 *
 * Drawn above the canvas rather than inside it, so a pin survives a board switch and
 * does not travel with the camera. Its geometry belongs to the shell: dragging or
 * resizing here never touches the placement on the board, which is what keeps the pin a
 * reading aid rather than a second layout.
 *
 * Content stays editable, because that is what a reader pins a card for: the point is to
 * keep writing in it while looking at something else. The board card underneath is a
 * static face while this exists, so there is still only ever one editor on the body.
 */
export function PinnedCards() {
  const pinned = usePinStore((state) => state.pinned);
  const rects = usePinStore((state) => state.rects);
  const setRect = usePinStore((state) => state.setRect);
  const unpin = usePinStore((state) => state.unpin);
  const workspace = useCanvasStore((state) => state.workspace);
  const localUser = usePresenceStore((state) => state.localUser);
  const snapshot = useWorkspaceSnapshot();
  const [rolled, setRolled] = useState<readonly string[]>([]);

  /** Settle the pins around the chrome, the way the board settles cards around each other. */
  const settle = useCallback(() => {
    const state = usePinStore.getState();
    if (state.pinned.length === 0) return;
    const moving = state.pinned
      .map((cardId) => state.rects[cardId])
      .filter((rect): rect is PinRect => rect !== undefined)
      .map((rect, index) => ({ id: `pin-${String(index)}`, ...rect }));
    const plan = planFloats({
      moving,
      obstacles: shellObstacles(),
      bounds: shellBounds(),
    });
    // The plan names its rects by position in the pinned order, so the ids line up again
    // here rather than being tracked through the solver.
    state.pinned.forEach((cardId, index) => {
      const rect = plan.rects[index];
      if (rect !== undefined)
        setRect(cardId, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    });
  }, [setRect]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pinned.length re-runs the settle when a pin is added or removed.
  useEffect(() => {
    settle();
    window.addEventListener("resize", settle);
    return () => window.removeEventListener("resize", settle);
  }, [settle, pinned.length]);

  const gesture = useFloatGesture({
    onMove: (cardId, rect) => setRect(cardId, rect),
    onEnd: settle,
  });

  if (pinned.length === 0 || workspace === null) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[40]"
      data-testid="pinned-cards"
      data-handbook-region="pinned-cards"
    >
      {pinned.map((cardId) => {
        const rect = rects[cardId];
        const card = snapshot.cards.find((entry) => entry.id === cardId);
        if (rect === undefined || card === undefined) return null;
        const isRolled = rolled.includes(cardId);
        const contentId = workspace.peekContent(cardId)?.id ?? null;
        const titleId = workspace.peekTitle(cardId)?.id ?? null;

        return (
          <div
            key={cardId}
            className="pointer-events-auto absolute flex flex-col overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--surface)] shadow-xl"
            data-testid={`pinned-card-${cardId}`}
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: isRolled ? 36 : rect.height,
            }}
          >
            {/* biome-ignore lint/a11y/noStaticElementInteractions: the header is a drag handle; the fold button beside it is the keyboard path. */}
            <div
              className="flex shrink-0 cursor-grab items-center gap-1.5 border-b border-[var(--hairline)] px-2 py-1.5"
              data-testid={`pinned-card-header-${cardId}`}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                const target = event.target as HTMLElement;
                if (target.closest("button")) return;
                event.preventDefault();
                gesture.start(event, { id: cardId, rect, mode: "move" });
              }}
              // Fold and unfold from the header, which is also the drag handle: move and
              // fold are then two gestures with one home each, never the same press.
              onDoubleClick={() => {
                setRolled((current) =>
                  current.includes(cardId)
                    ? current.filter((id) => id !== cardId)
                    : [...current, cardId],
                );
              }}
            >
              <div className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                <StaticCardTitle cardDoc={workspace.doc} titleId={titleId} />
              </div>
              <button
                type="button"
                aria-label={isRolled ? "Unfold card" : "Fold card"}
                aria-expanded={!isRolled}
                data-testid={`pinned-card-fold-${cardId}`}
                className="shrink-0 rounded px-1 text-[11px] leading-none text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() =>
                  setRolled((current) =>
                    current.includes(cardId)
                      ? current.filter((id) => id !== cardId)
                      : [...current, cardId],
                  )
                }
              >
                {isRolled ? "\u25b8" : "\u25be"}
              </button>
              <button
                type="button"
                aria-label="Unpin card"
                data-testid={`pinned-card-unpin-${cardId}`}
                className="shrink-0 rounded px-1 text-[11px] leading-none text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => unpin(cardId)}
              >
                {"\u00d7"}
              </button>
            </div>

            {isRolled ? null : (
              <div className="min-h-0 flex-1 overflow-auto p-2">
                {contentId === null ? (
                  // A card that has never been written has no body container to bind an
                  // editor to; the board card creates one when it is first edited.
                  <p className="text-[11px] text-[var(--ink-muted)]">No content yet</p>
                ) : (
                  <CardBodyEditor
                    cardId={cardId}
                    cardDoc={workspace.doc}
                    contentId={contentId}
                    cursorStore={null}
                    localUser={localUser}
                    editable={true}
                  />
                )}
              </div>
            )}

            {isRolled ? null : (
              <button
                type="button"
                aria-label="Resize pinned card"
                data-testid={`pinned-card-resize-${cardId}`}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  gesture.start(event, { id: cardId, rect, mode: "resize" });
                }}
                className="absolute right-0 bottom-0 h-3 w-3 cursor-nwse-resize rounded-tl border-t border-l border-[var(--hairline)] bg-[var(--surface)]"
                style={{ touchAction: "none" }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
