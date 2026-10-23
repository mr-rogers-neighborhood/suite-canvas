import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI, ExcalidrawProps } from "@excalidraw/excalidraw/types";
import type { Drawing, DrawingElement } from "@suite/graph";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { useThemeStore } from "../theme/useThemeStore";
import "../styles/whiteboard-surface.css";

const LazyExcalidraw = lazy(async () => {
  const [module] = await Promise.all([
    import("@excalidraw/excalidraw"),
    import("@excalidraw/excalidraw/index.css"),
  ]);
  return { default: module.Excalidraw };
});

/** Excalidraw's own version counter is enough to tell "local echo" from "peer edit". */
function sceneSignature(elements: readonly ExcalidrawElement[]): string {
  let signature = `${elements.length}:`;
  for (const element of elements) {
    signature += `${element.id}:${element.version};`;
  }
  return signature;
}

function drawingSignature(elements: readonly DrawingElement[]): string {
  return sceneSignature(elements as unknown as ExcalidrawElement[]);
}

export interface WhiteboardCommit {
  elements: DrawingElement[];
  order: string[];
}

export interface WhiteboardSurfaceProps {
  drawing: Drawing;
  readOnly?: boolean;
  /** Called after the last change settles; one commit per pause/gesture. */
  onCommit: (commit: WhiteboardCommit) => void;
}

/**
 * The Excalidraw editing surface is lazy: the board face never pays for it, and
 * the focus surface mounts it only when a whiteboard is actually opened.
 */
export function WhiteboardSurface({ drawing, readOnly = false, onCommit }: WhiteboardSurfaceProps) {
  const theme = useThemeStore((state) => state.theme);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const pending = useRef<WhiteboardCommit | null>(null);
  const commitTimer = useRef<number | null>(null);
  const lastEmitted = useRef<string>(drawingSignature(drawing.elements));
  const lastApplied = useRef<string>(drawingSignature(drawing.elements));

  const flush = useCallback(() => {
    if (commitTimer.current !== null) {
      window.clearTimeout(commitTimer.current);
      commitTimer.current = null;
    }
    const commit = pending.current;
    pending.current = null;
    if (commit) {
      lastEmitted.current = drawingSignature(commit.elements);
      onCommit(commit);
    }
  }, [onCommit]);

  useEffect(
    () => () => {
      flush();
    },
    [flush],
  );

  const handleChange = useCallback<NonNullable<ExcalidrawProps["onChange"]>>(
    (elements) => {
      if (readOnly) return;
      const live = elements.filter(
        (element) => (element as unknown as { isDeleted?: boolean }).isDeleted !== true,
      );
      const signature = sceneSignature(live);
      if (signature === lastEmitted.current) return;
      pending.current = {
        elements: live as unknown as DrawingElement[],
        order: live.map((element) => element.id),
      };
      if (commitTimer.current !== null) window.clearTimeout(commitTimer.current);
      commitTimer.current = window.setTimeout(flush, 300);
    },
    [flush, readOnly],
  );

  const incoming = useMemo(() => drawingSignature(drawing.elements), [drawing.elements]);
  useEffect(() => {
    const api = apiRef.current;
    if (!api || incoming === lastApplied.current || incoming === lastEmitted.current) return;
    api.updateScene({ elements: drawing.elements as unknown as ExcalidrawElement[] });
    lastApplied.current = incoming;
    // updateScene re-emits onChange; mark it as applied so the echo is not
    // written back to the graph.
    lastEmitted.current = incoming;
  }, [drawing.elements, incoming]);

  const initialData = useMemo(
    () => ({
      elements: drawing.elements as unknown as ExcalidrawElement[],
      appState: {
        viewBackgroundColor: "transparent",
        theme,
      },
    }),
    [drawing.elements, theme],
  );

  const uiOptions = useMemo(
    () => ({
      canvasActions: {
        loadScene: false,
        saveToActiveFile: false,
        export: false as const,
        saveAsImage: false,
        clearCanvas: false,
        toggleTheme: false,
        changeViewBackgroundColor: false,
      },
    }),
    [],
  );

  return (
    <div className="whiteboard-surface" data-testid="whiteboard-surface">
      <Suspense fallback={<div className="whiteboard-surface__loading">Loading whiteboard…</div>}>
        <LazyExcalidraw
          initialData={initialData}
          theme={theme}
          viewModeEnabled={readOnly}
          UIOptions={uiOptions}
          onChange={handleChange}
          excalidrawAPI={(api: ExcalidrawImperativeAPI) => {
            apiRef.current = api;
          }}
          name="Suite whiteboard"
        />
      </Suspense>
    </div>
  );
}
