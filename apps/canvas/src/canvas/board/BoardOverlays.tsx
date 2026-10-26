import "@xyflow/react/dist/style.css";
import { StatusCursorLayer } from "../../cursor/StatusCursorLayer";
import { ContextMenu, type ContextMenuItem } from "../../dialogs/ContextMenu";
import { ExplainPanel } from "../../panels/ExplainPanel";
import { EdgeDescriptionInput } from "../EdgeDescription";
import { HeldStackCursor } from "../HeldStackCursor";
import { LibraryDropPreview } from "../PeerLibraryDragLayer";
import { PlacementRunBar } from "../PlacementRunBar";
import { PortalTransitionLayer } from "../PortalTransitionLayer";
import type { usePlacementEngine } from "../usePlacementEngine";
import { ThreadLinkPreview } from "./ThreadLinkPreview";
import type { useBoardLinks } from "./useBoardLinks";
import type { useBoardProjection } from "./useBoardProjection";
import type { useBoardUi } from "./useBoardUi";

type BoardOverlaysProps = {
  ui: ReturnType<typeof useBoardUi>;
  projection: ReturnType<typeof useBoardProjection>;
  links: ReturnType<typeof useBoardLinks>;
  menuItems: ContextMenuItem[];
  placementEngine: ReturnType<typeof usePlacementEngine>;
};

/**
 * What the board draws outside React Flow: its pane swallows pointerdown, so the
 * run bar, the cursors, the portal transition, the label editor and the context
 * menu sit beside it rather than inside it.
 */
export function BoardOverlays({
  ui,
  projection,
  links,
  menuItems,
  placementEngine,
}: BoardOverlaysProps) {
  const { activeBoardId, closeContextMenu, contextMenu } = ui;
  const { linkScene } = projection;
  const {
    armedThread,
    threadCursor,
    edgeDescription,
    commitEdgeDescription,
    cancelEdgeDescription,
  } = links;

  return (
    <>
      {/* Outside React Flow: its pane preventDefaults pointerdown, which eats the
          click on any control nested inside it. */}
      {armedThread && threadCursor && activeBoardId ? (
        <ThreadLinkPreview
          endpoint={armedThread}
          cursor={threadCursor}
          scene={linkScene}
          boardId={activeBoardId}
        />
      ) : null}
      <PlacementRunBar engine={placementEngine} />
      <ExplainPanel />
      <StatusCursorLayer />
      <HeldStackCursor engine={placementEngine} />
      <LibraryDropPreview />
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
