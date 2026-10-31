import { useEffect } from "react";
import { targetAtElement } from "../../cards/tour";
import { markBoot, measureBoot } from "../../dev/bootTiming";
import { countRender } from "../../dev/perf";
import { usePublishLibraryDrag } from "../PeerLibraryDragLayer";
import { isRecording, useRecordRunStore } from "../recordRun";
import { useRecordEngine } from "../useRecordEngine";
import { BoardOverlays } from "./BoardOverlays";
import { BoardSurface } from "./BoardSurface";
import { useBoardCamera } from "./useBoardCamera";
import { useBoardCommands } from "./useBoardCommands";
import { useBoardKeyboard } from "./useBoardKeyboard";
import { useBoardLinks } from "./useBoardLinks";
import { useBoardMenu } from "./useBoardMenu";
import { useBoardNodes } from "./useBoardNodes";
import { useBoardProjection } from "./useBoardProjection";
import { useBoardRefs } from "./useBoardRefs";
import { useBoardSections } from "./useBoardSections";
import { useBoardSelection } from "./useBoardSelection";
import { useBoardUi } from "./useBoardUi";
import { useNoTextSelection } from "./useNoTextSelection";

/** Pointer samples published to peers land at most once per this window. */
const POINTER_THROTTLE_MS = 60;
/**
 * What a click still means while recording: a control inside a card keeps its
 * own behaviour, so the step intercept stays as narrow as the purpose that
 * armed it. Only the card's own chrome is listed — a press on its body, or on
 * the title overlay that sits over it, *is* the step.
 */
const RECORD_CLICK_THROUGH =
  "button[data-testid], a, input, select, textarea, [role='button'], [role='menuitem'], [role='checkbox']";

/**
 * The board: its hooks, in the one order they can be wired, and the shell that
 * hosts the React Flow surface and the overlays beside it. Everything visual
 * lives in `BoardSurface` and `BoardOverlays`; everything the document owns
 * lives in the hooks.
 */
export function BoardView() {
  countRender("canvas");
  const ui = useBoardUi();
  const { setPointer, selectedConnector, screenToFlowPosition } = ui;
  usePublishLibraryDrag();

  useEffect(() => {
    markBoot("canvas:mounted");
    measureBoot("to-canvas", "store:created", "canvas:mounted");
  }, []);

  /** The record lane's one engine. */
  const recordEngine = useRecordEngine();

  // Board-scoped views derived from the snapshot, so a CRDT change anywhere
  // recomputes exactly once per board.
  const projection = useBoardProjection(ui);
  const { boardOrder } = projection;

  const refs = useBoardRefs(ui, boardOrder);
  const { lastPointerSent, marqueePress, boardRoot } = refs;

  // Shift is the marquee key, so the browser must not read the same shift as "extend
  // the selection": without this a shift+drag swept the page's text instead. Document
  // wide, because the sweep grows out of whatever was selected before it, wherever that
  // was, and the board is the only surface this hook is mounted on.
  useNoTextSelection();

  const links = useBoardLinks(ui, { refs, projection });
  const { labelHandlers, startEdgeDescription } = links;

  const camera = useBoardCamera(ui, { projection });
  const { enterPortal } = camera;

  const sections = useBoardSections(ui, { projection });
  const { cardOffsetsMap, createSectionAt } = sections;

  const nodesApi = useBoardNodes(ui, { refs, projection, cardOffsetsMap, labelHandlers });

  const selection = useBoardSelection(ui, { refs, projection, nodes: nodesApi });

  const commands = useBoardCommands(ui, { projection });

  useBoardKeyboard(ui, {
    projection,
    refs,
    createNoteAt: commands.createNoteAt,
    nudgeSelected: commands.nudgeSelected,
    trashSelected: commands.trashSelected,
    unplaceSelected: commands.unplaceSelected,
    createSectionAt,
    enterPortal,
  });

  const menuItems = useBoardMenu(ui, {
    projection,
    sections,
    commands,
    enterPortal,
    startEdgeDescription,
  });

  return (
    <div
      data-testid="canvas-board"
      data-handbook-region="canvas-surface"
      ref={boardRoot}
      className={`h-full w-full ${selectedConnector ? "connector-active" : ""}`}
      // Capture, not bubble: React Flow stops the pane's pointerdown from
      // propagating, so a bubble handler here never sees a press on the canvas at
      // all — which silently made every box start from "no section".
      onPointerDownCapture={(event) => {
        marqueePress.current = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      }}
      // Recording claims the click (ADR-0064 §9): while it is live, a press on a
      // card is a step rather than a selection or an inspector. Capture, because
      // the card and React Flow both act on the bubble phase, and the purpose —
      // not the gesture — has to decide the click first.
      onClickCapture={(event) => {
        if (!isRecording()) return;
        const element = event.target instanceof Element ? event.target : null;
        const target = targetAtElement(element);
        if (!target) return;
        // The tour's own card is where the steps land, not a stop on the tour:
        // pressing it opens the Steps panel instead of recording a step that
        // points at itself.
        if (target.kind === "card" && target.id === useRecordRunStore.getState().tutorialId) {
          return;
        }
        // A control *inside* the card keeps its own meaning; the card's body is
        // the step. The card is compared, not just the match, so a wrapper that
        // happens to carry a role cannot swallow every press.
        const card = element?.closest("[data-node-id]") ?? null;
        const control = element?.closest(RECORD_CLICK_THROUGH) ?? null;
        if (card && control && control !== card && card.contains(control)) return;
        event.preventDefault();
        event.stopPropagation();
        recordEngine.record(target);
      }}
      onPointerMove={(event) => {
        const now = performance.now();
        if (now - lastPointerSent.current < POINTER_THROTTLE_MS) return;
        lastPointerSent.current = now;
        setPointer(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
      }}
      onPointerLeave={() => setPointer(null)}
    >
      <BoardSurface
        ui={ui}
        refs={refs}
        projection={projection}
        sections={sections}
        nodesApi={nodesApi}
        selection={selection}
        links={links}
        camera={camera}
        commands={commands}
      />
      <BoardOverlays ui={ui} projection={projection} links={links} menuItems={menuItems} />
    </div>
  );
}
