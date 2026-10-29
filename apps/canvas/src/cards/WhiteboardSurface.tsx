import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import type { Drawing, DrawingElement } from "@suite/graph";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  attachmentId,
  isAttachmentMime,
  markAttachmentUploaded,
  readLocalAttachment,
  storeLocalAttachment,
} from "../editor/attachmentNode";
import type { PasteUploader } from "../editor/pasteImages";
import { useThemeStore } from "../theme/useThemeStore";
import {
  bytesFromDataUrl,
  dataUrlOf,
  fetchPicture,
  sketchFileRefs,
  withSketchFile,
} from "./sketchFiles";
import { createSketchCommitBatcher, toDrawingElement } from "./whiteboard";
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
  /**
   * Stores one picture's bytes beside the document. `null` means this page has
   * nowhere to put them (a share session, offline, a standalone build), so the
   * image tool is not offered rather than pasting a picture that will not last.
   */
  upload?: PasteUploader | null;
}

/**
 * The Excalidraw editing surface is lazy: the board face never pays for it, and
 * the focus surface mounts it only when a sketch is actually opened.
 */
export function WhiteboardSurface({
  drawing,
  readOnly = false,
  onCommit,
  upload = null,
}: WhiteboardSurfaceProps) {
  const theme = useThemeStore((state) => state.theme);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  // The API arrives after the first render, and restoring a sketch's pictures has
  // to wait for it: state rather than only a ref, so the effect runs again.
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  // How many pictures the surface holds, so a test can tell restored bytes from a
  // restored element that points at nothing.
  const [fileCount, setFileCount] = useState(0);
  const lastEmitted = useRef<string>(drawingSignature(drawing.elements));
  const lastApplied = useRef<string>(drawingSignature(drawing.elements));

  // Excalidraw reports every pointer sample of a freehand stroke. A gesture
  // suppresses the idle timer and lands the whole stroke in one commit on
  // pointer-up, so undo and the peer sync see one line, not three hundred.
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const batcher = useMemo(
    () =>
      createSketchCommitBatcher<WhiteboardCommit>((commit) => {
        lastEmitted.current = drawingSignature(commit.elements);
        onCommitRef.current(commit);
      }),
    [],
  );

  useEffect(() => {
    const begin = () => batcher.beginGesture();
    const end = () => batcher.endGesture();
    // Capture phase: Excalidraw's own handlers stop propagation on the canvas.
    window.addEventListener("pointerdown", begin, true);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerdown", begin, true);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [batcher]);

  // Closing the surface must not drop the stroke that is still in flight.
  useEffect(
    () => () => {
      batcher.flush();
      batcher.dispose();
    },
    [batcher],
  );

  // The scene Excalidraw last reported, and the pictures stored during this
  // sitting. Excalidraw's own elements never carry our stamp, so every commit is
  // built through `stampElements` rather than from the scene directly: a stroke
  // drawn after a picture must not drop the id that picture is stored under.
  const liveRef = useRef<readonly ExcalidrawElement[]>([]);
  const stamping = useRef<Map<string, string>>(new Map());
  const storing = useRef<Set<string>>(new Set());
  const refused = useRef<Set<string>>(new Set());

  const stampElements = useCallback(
    (elements: readonly ExcalidrawElement[]): DrawingElement[] =>
      elements.map((element) => {
        const clean = toDrawingElement(element as unknown as DrawingElement);
        const fileId = (clean as { fileId?: unknown }).fileId;
        const storedAs = typeof fileId === "string" ? stamping.current.get(fileId) : undefined;
        return typeof fileId === "string" && storedAs !== undefined
          ? withSketchFile(clean, fileId, storedAs)
          : clean;
      }),
    [],
  );

  const stampFile = useCallback(
    (fileId: string, storedAs: string) => {
      const live = liveRef.current.filter(
        (element) => (element as unknown as { fileId?: string }).fileId === fileId,
      );
      // The picture was deleted while it stored: the bytes are left for the
      // workspace's own cleanup rather than resurrecting the element.
      if (live.length === 0) return;
      stamping.current.set(fileId, storedAs);
      onCommitRef.current({
        elements: stampElements(liveRef.current),
        order: liveRef.current.map((one) => one.id),
      });
    },
    [stampElements],
  );

  const storePictures = useCallback(
    (files: Record<string, { id: string; dataURL: string; mimeType: string }>) => {
      for (const file of Object.values(files)) {
        if (storing.current.has(file.id) || refused.current.has(file.id)) continue;
        // Already stored, by an earlier commit, a peer, or this sitting.
        if (stamping.current.has(file.id)) continue;
        if (
          sketchFileRefs(liveRef.current as unknown as DrawingElement[]).some(
            (ref) => ref.fileId === file.id,
          )
        ) {
          continue;
        }
        if (!isAttachmentMime(file.mimeType)) continue;
        const bytes = bytesFromDataUrl(file.dataURL);
        if (bytes === null) continue;
        storing.current.add(file.id);
        const storedAs = attachmentId();
        void (async () => {
          try {
            // This browser keeps the bytes first, so the picture is back after a
            // reload whether or not a relay took them: the same policy a pasted
            // image follows. The id is the node's own, so a later upload lands on
            // the copy a peer would read.
            await storeLocalAttachment(storedAs, bytes, file.mimeType);
            stampFile(file.id, storedAs);
            if (upload === null) return;
            await upload({ id: storedAs, bytes, mime: file.mimeType });
            await markAttachmentUploaded(storedAs);
          } catch (error) {
            // LOCAL-ONLY: no relay, offline, or not signed in. The sketch renders
            // here and a share viewer does not see the picture until it uploads.
            refused.current.add(file.id);
            console.warn("[sketch] a picture is stored in this browser only", error);
          } finally {
            storing.current.delete(file.id);
          }
        })();
      }
    },
    [stampFile, upload],
  );

  const handleChange = useCallback<NonNullable<ExcalidrawProps["onChange"]>>(
    (elements, _appState, files) => {
      if (readOnly) return;
      const live = elements.filter(
        (element) => (element as unknown as { isDeleted?: boolean }).isDeleted !== true,
      );
      liveRef.current = live;
      setFileCount(Object.keys(files).length);
      storePictures(files);
      const signature = sceneSignature(live);
      if (signature === lastEmitted.current) return;
      // Excalidraw's own elements carry `undefined` for every unused optional key,
      // which the drawing schema refuses, and they never carry a picture's stored
      // id; `stampElements` is the one boundary that settles both.
      batcher.schedule({ elements: stampElements(live), order: live.map((one) => one.id) });
    },
    [batcher, readOnly, stampElements, storePictures],
  );

  // A stored picture is fetched back into Excalidraw, which keeps its own copy of
  // the bytes: the document holds ids, never image data.
  const fileRefs = useMemo(() => sketchFileRefs(drawing.elements), [drawing.elements]);
  const restoredRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!api) return;
    const missing = fileRefs.filter((ref) => !restoredRef.current.has(ref.fileId));
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      const files: BinaryFileData[] = [];
      for (const ref of missing) {
        restoredRef.current.add(ref.fileId);
        try {
          // This browser's copy first, the relay's second: an upload may have
          // happened on another machine, and a local copy is faster either way.
          const local = await readLocalAttachment(ref.attachmentId);
          const stored =
            local !== null ? { bytes: local.bytes, mime: local.mime } : await fetchPicture(ref);
          if (stored === null) continue;
          files.push({
            id: ref.fileId as BinaryFileData["id"],
            mimeType: stored.mime.split(";")[0] as BinaryFileData["mimeType"],
            dataURL: dataUrlOf(stored.bytes, stored.mime) as BinaryFileData["dataURL"],
            created: Date.now(),
          });
        } catch {
          // A picture that will not load is left out: the rest of the scene still
          // opens, and the element shows Excalidraw's own broken-image state.
          restoredRef.current.delete(ref.fileId);
        }
      }
      if (!cancelled && files.length > 0) api.addFiles(files);
    })();
    return () => {
      cancelled = true;
    };
  }, [api, fileRefs]);

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
    <div
      className="whiteboard-surface"
      data-testid="whiteboard-surface"
      // What the scene behind the canvas holds, so a test can tell a restored
      // stroke from an empty surface without reaching into Excalidraw's canvas.
      data-elements={drawing.elements.length}
      data-files={fileCount}
    >
      <Suspense fallback={<div className="whiteboard-surface__loading">Loading sketch…</div>}>
        <LazyExcalidraw
          initialData={initialData}
          theme={theme}
          viewModeEnabled={readOnly}
          UIOptions={uiOptions}
          onChange={handleChange}
          excalidrawAPI={(instance: ExcalidrawImperativeAPI) => {
            apiRef.current = instance;
            setApi(instance);
          }}
          name="Suite sketch"
        />
      </Suspense>
    </div>
  );
}
