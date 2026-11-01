import "@xyflow/react/dist/style.css";
import { StatusCursorLayer } from "../../cursor/StatusCursorLayer";
import { ContextMenu, type ContextMenuItem } from "../../dialogs/ContextMenu";
import { handbookEnabled } from "../../handbook/availability";
import { ExplainPanel } from "../../panels/ExplainPanel";
import { viewsEnabled } from "../../views/availability";
import { NudgeHint } from "../BoardHints";
import { DropOffer } from "../DropOffer";
import { EdgeDescriptionInput } from "../EdgeDescription";
import { HighlightDropLayer } from "../HighlightDropLayer";
import { LibraryDropPreview } from "../PeerLibraryDragLayer";
import { PlaceStackCursor } from "../PlaceStackCursor";
import { PlaceStackOutline } from "../PlaceStackOutline";
import { PortalTransitionLayer } from "../PortalTransitionLayer";
import { ProjectionFloat } from "../ProjectionFloat";
import { ReturnToBookBar } from "../ReturnToBookBar";
import { ThreadLinkPreview } from "./ThreadLinkPreview";
import type { useBoardLinks } from "./useBoardLinks";
import type { useBoardProjection } from "./useBoardProjection";
import type { useBoardUi } from "./useBoardUi";

type BoardOverlaysProps = {
  ui: ReturnType<typeof useBoardUi>;
  projection: ReturnType<typeof useBoardProjection>;
  links: ReturnType<typeof useBoardLinks>;
  menuItems: ContextMenuItem[];
};

/**
 * What the board draws outside React Flow: its pane swallows pointerdown, so the
 * cursors, the portal transition, the label editor and the context menu sit beside
 * it rather than inside it.
 */
export function BoardOverlays({ ui, projection, links, menuItems }: BoardOverlaysProps) {
  const { activeBoardId, closeContextMenu, contextMenu, selectedNodeIds, canEditLayout, mode } = ui;
  const { linkScene } = projection;
  const {
    armedThread,
    armedShape,
    threadCursor,
    edgeDescription,
    commitEdgeDescription,
    cancelEdgeDescription,
  } = links;

  const showThreadPreview =
    Boolean(armedThread) &&
    Boolean(threadCursor) &&
    Boolean(activeBoardId) &&
    (mode !== "place" || armedShape === "thread" || armedShape === "fan");

  return (
    <>
      {/* Outside React Flow: its pane preventDefaults pointerdown, which eats the
          click on any control nested inside it. */}
      {showThreadPreview && armedThread && threadCursor && activeBoardId ? (
        <ThreadLinkPreview
          endpoint={armedThread}
          cursor={threadCursor}
          scene={linkScene}
          boardId={activeBoardId}
        />
      ) : null}
      {canEditLayout && selectedNodeIds.length > 0 ? (
        <NudgeHint count={selectedNodeIds.length} lifted={selectedNodeIds.length > 1} />
      ) : null}
      <DropOffer />
      {/* Nothing can project while the views surfaces are shut, and a float with no way to open it
          would be chrome for a feature the reader cannot reach. */}
      <HighlightDropLayer />
      {viewsEnabled ? <ProjectionFloat /> : null}
      {/* Explain's gathered context lives in the handbook when this build has one, and stands
          on its own over the board when it does not. */}
      {handbookEnabled ? null : <ExplainPanel />}
      <StatusCursorLayer />
      <LibraryDropPreview />
      <PlaceStackCursor />
      {/* What is in hand, and in what order it will go down: a stack is placed one press at a time, so the order is the
          one decision the reader can still make. */}
      <PlaceStackOutline />
      {/* The moment after the last press, held open: the board is still usable and the reader says when they are done. */}
      <ReturnToBookBar />
      <PortalTransitionLayer />
      {edgeDescription ? (
        <EdgeDescriptionInput
          key={edgeDescription.edgeId}
          x={edgeDescription.x}
          y={edgeDescription.y}
          value={edgeDescription.value}
          onCommit={commitEdgeDescription}
          onCancel={cancelEdgeDescription}
        />
      ) : null}
      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={closeContextMenu}
        />
      ) : null}
    </>
  );
}
