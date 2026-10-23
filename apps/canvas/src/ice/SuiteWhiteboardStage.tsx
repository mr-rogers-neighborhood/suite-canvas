import type { Drawing } from "@suite/graph";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WhiteboardPreview } from "../cards/WhiteboardPreview";
import { type WhiteboardCommit, WhiteboardSurface } from "../cards/WhiteboardSurface";
import { useDrawing } from "../hooks/useDrawing";

/**
 * The inline whiteboard editor for the ICE port: one intent-gated Excalidraw
 * instance at full LOD, an SVG preview everywhere else.
 *
 * The stage is the *only* place an inline whiteboard editor may exist. It is a
 * screen-space overlay (the lead positions it from `SuiteCardBox`), it mounts
 * exactly one `WhiteboardSurface`, and it owns the boundaries the editor must
 * not own:
 *
 * - **Card isolation.** The active card id is the surface's `sceneIdentity`, so
 *   switching cards re-points the same Excalidraw instance at the new drawing
 *   instead of remounting it, and no scene or history leaks across the switch.
 * - **Camera isolation.** The root takes pointer events, and wheel/pointer
 *   events inside stop propagating: Excalidraw's own pan/zoom stays inside the
 *   card box and never reaches the workspace camera.
 * - **Suspend, do not unmount.** `suspended` hides the editor's paint and drops
 *   pointer routing with `content-visibility: hidden` while the workspace
 *   camera moves. The React tree (and with it the caret, the selection and
 *   Excalidraw's own camera) survives, because a remount plus rehydration is the
 *   expensive path and is where editors lose state (ADR-0036 amendment).
 * - **No blank frame.** The resolution-independent SVG preview is the underlay
 *   until Excalidraw's root has mounted for this card, then the editor fades in
 *   over it.
 */

/** Screen-space box of the card being edited (`SuiteCardBox` satisfies it). */
export interface SuiteWhiteboardStageBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /**
   * The workspace camera zoom. The shell is laid out in screen px so the
   * editor chrome stays readable; `scale` is reported for chrome that needs to
   * counter-scale.
   */
  readonly scale: number;
}

export interface SuiteWhiteboardStageProps {
  /** The card whose editor is open; `null` means no editor exists at all. */
  activeCardId: string | null;
  /** The card's current screen box; `null` unmounts the editor. */
  box: SuiteWhiteboardStageBox | null;
  readOnly?: boolean;
  /**
   * True while the workspace camera is moving. The editor stays mounted and
   * keeps its state; it only loses paint and pointer routing.
   */
  suspended?: boolean;
  /**
   * A settled edit for `cardId`. The lead applies it through
   * `workspace.applyDrawing(cardId, commit.elements, commit.order)`; the stage
   * never writes the document itself.
   */
  onCommit: (cardId: string, commit: WhiteboardCommit) => void;
  /**
   * The reader asked to leave the card, via Escape. The lead's contract is
   * "leave the card camera first, then the editor": move the workspace camera
   * back out, then clear `activeCardId` so the stage unmounts the editor.
   */
  onExit: () => void;
  className?: string;
}

/** Excalidraw's own root element; its arrival is the editor's first paint. */
const EXCALIDRAW_ROOT = ".excalidraw";

/** Gestures that belong to the editor's camera, never to the workspace one. */
const LOCAL_GESTURES = ["wheel", "pointerdown", "pointermove", "pointerup", "pointercancel"];

const EMPTY: readonly never[] = [];

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function SuiteWhiteboardStage({
  activeCardId,
  box,
  readOnly = false,
  suspended = false,
  onCommit,
  onExit,
  className,
}: SuiteWhiteboardStageProps) {
  const drawing = useDrawing(activeCardId);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const mounted = activeCardId !== null && box !== null;
  const ready = activeCardId !== null && readyFor === activeCardId;

  // An unmounted stage has nothing ready; the next card starts on its preview.
  useEffect(() => {
    if (activeCardId === null) setReadyFor(null);
  }, [activeCardId]);

  // The surface gives no callback for "Excalidraw is on screen", so readiness
  // is observed where it is visible: the editor's own root node. Until it
  // exists the preview underlay is what the reader sees.
  useEffect(() => {
    if (activeCardId === null || !mounted) return;
    const host = hostRef.current;
    if (host === null) return;
    const markReady = () => setReadyFor(activeCardId);
    if (host.querySelector(EXCALIDRAW_ROOT) !== null) {
      markReady();
      return;
    }
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => {
      if (host.querySelector(EXCALIDRAW_ROOT) === null) return;
      observer.disconnect();
      markReady();
    });
    observer.observe(host, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [activeCardId, mounted]);

  const commit = useCallback(
    (next: WhiteboardCommit) => {
      if (activeCardId !== null) onCommit(activeCardId, next);
    },
    [activeCardId, onCommit],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Excalidraw sees the key at the target first (text edit, tool cancel);
      // by the time it bubbles here the editor has finished its own Escape.
      onExit();
    },
    [onExit],
  );

  // Native listeners, not React ones: the stage is a static shell, and the
  // bubble stop has to happen on this element before the workspace camera sees
  // the gesture. One rule for every gesture the board must not receive: the
  // editor is a local camera, not a view of the board.
  useEffect(() => {
    if (!mounted) return;
    const host = hostRef.current;
    if (host === null) return;
    const stop = (event: Event) => event.stopPropagation();
    for (const type of LOCAL_GESTURES) host.addEventListener(type, stop);
    host.addEventListener("keydown", handleKeyDown);
    return () => {
      for (const type of LOCAL_GESTURES) host.removeEventListener(type, stop);
      host.removeEventListener("keydown", handleKeyDown);
    };
  }, [mounted, handleKeyDown]);

  const effective = useMemo<Drawing>(
    () =>
      drawing ?? {
        cardId: activeCardId ?? "",
        elements: [],
        order: [],
        version: 1,
        updatedAt: 0,
      },
    [drawing, activeCardId],
  );

  // Hooks are unconditional; the editor itself only exists for a live card.
  if (activeCardId === null || box === null) return null;

  const shellStyle: CSSProperties = {
    position: "absolute",
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    overflow: "hidden",
    borderRadius: "var(--card-radius, 12px)",
    background: "var(--surface)",
    contain: "layout paint",
    pointerEvents: suspended ? "none" : "auto",
    zIndex: 3,
  };

  const editorStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    opacity: ready ? 1 : 0,
    transition: prefersReducedMotion() ? undefined : "opacity 140ms ease-out",
    contentVisibility: suspended ? "hidden" : "visible",
    pointerEvents: suspended ? "none" : "auto",
  };

  const previewStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    padding: 8,
    pointerEvents: "none",
  };

  return (
    <div
      ref={hostRef}
      className={`suite-whiteboard-stage${className ? ` ${className}` : ""}`}
      data-testid="suite-whiteboard-stage"
      data-card-id={activeCardId}
      data-camera-scale={box.scale}
      data-suspended={suspended ? "true" : "false"}
      data-ready={ready ? "true" : "false"}
      style={shellStyle}
      tabIndex={-1}
    >
      {ready ? null : (
        <div
          className="suite-whiteboard-stage__preview"
          data-testid="suite-whiteboard-stage-preview"
          style={previewStyle}
          aria-hidden="true"
        >
          <WhiteboardPreview elements={drawing?.elements ?? EMPTY} />
        </div>
      )}
      <div
        className="suite-whiteboard-stage__editor"
        data-testid="suite-whiteboard-stage-editor"
        style={editorStyle}
      >
        <WhiteboardSurface
          drawing={effective}
          readOnly={readOnly}
          sceneIdentity={activeCardId}
          onCommit={commit}
        />
      </div>
    </div>
  );
}
