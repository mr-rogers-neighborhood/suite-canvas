/**
 * The inline whiteboard stage, and why it is only suspended.
 *
 * A whiteboard card is drawn by the GPU until a double click opens Excalidraw
 * over it. While a pointer is down the canvas is being driven, not read, so the
 * stage *suspends* its paint instead of unmounting: a drag, a pan or a resize
 * must not tear down (and rehydrate) an editor, and Excalidraw must keep its own
 * camera and caret.
 *
 * The stage never writes the document: a settled edit comes back through
 * `onCommit` and the lead applies it, which is why the commit lives here.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { type IceSurfaceRefs, type IceWiring, resolveSurface } from "./iceSurfaceWiring";
import type { SuiteWhiteboardStageBox, SuiteWhiteboardStageProps } from "./SuiteWhiteboardStage";

export interface IceWhiteboard {
  /** What the stage needs, or `null` when no editor is open. */
  readonly stage: SuiteWhiteboardStageProps | null;
  /** A double click on a whiteboard card opens its editor at this box. */
  readonly open: (cardId: string, box: SuiteWhiteboardStageBox) => void;
  /**
   * Closes the stage, if any. The whiteboard stage and the in-place card editor
   * are the desk's only two DOM editors and never coexist (ADR-0042), so the
   * surface closes this one when a text editor opens and closes the text editor
   * when this one opens.
   */
  readonly close: () => void;
}

export function useIceWhiteboard(input: {
  readonly wiring: IceWiring;
  readonly refs: IceSurfaceRefs;
}): IceWhiteboard {
  const { wiring, refs } = input;
  const [whiteboard, setWhiteboard] = useState<{
    cardId: string;
    box: SuiteWhiteboardStageBox;
  } | null>(null);
  const [suspended, setSuspended] = useState(false);

  useEffect(() => {
    const { phase, seed, layerReady, workspaceMode, liveWorkspace, rootBoardId } = wiring;
    if (phase.kind !== "ready" || seed === null || layerReady === 0) return;
    if (!workspaceMode || liveWorkspace === null || rootBoardId === null) return;
    const dom = resolveSurface(refs);
    if (dom === null) return;
    const { root } = dom;

    // While a pointer is down the canvas is being driven, not read: the inline
    // whiteboard suspends its paint instead of being unmounted, so its editor
    // keeps its caret and Excalidraw keeps its own camera.
    const suspendOn = (): void => setSuspended(true);
    const suspendOff = (): void => setSuspended(false);
    root.addEventListener("pointerdown", suspendOn, true);
    root.addEventListener("pointerup", suspendOff, true);
    root.addEventListener("pointercancel", suspendOff, true);

    return () => {
      root.removeEventListener("pointerdown", suspendOn, true);
      root.removeEventListener("pointerup", suspendOff, true);
      root.removeEventListener("pointercancel", suspendOff, true);
    };
  }, [wiring, refs]);

  const open = useCallback((cardId: string, box: SuiteWhiteboardStageBox): void => {
    setWhiteboard({ cardId, box });
  }, []);
  const close = useCallback((): void => setWhiteboard(null), []);

  const stage = useMemo<SuiteWhiteboardStageProps | null>(() => {
    if (whiteboard === null) return null;
    return {
      activeCardId: whiteboard.cardId,
      box: whiteboard.box,
      readOnly: !wiring.caps.canWriteLayout,
      suspended,
      onCommit: (cardId, commit) => {
        const workspace = wiring.liveWorkspace;
        if (workspace === null) return;
        try {
          workspace.applyDrawing(cardId, commit.elements, commit.order);
        } catch (error) {
          console.warn("[ice] could not save whiteboard", error);
        }
      },
      onExit: close,
    };
  }, [whiteboard, wiring.caps.canWriteLayout, suspended, wiring.liveWorkspace, close]);

  return useMemo(() => ({ stage, open, close }), [stage, open, close]);
}
