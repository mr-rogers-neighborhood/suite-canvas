import { sectionsAt } from "@suite/graph";
import { Background, ConnectionMode, Controls, ReactFlow, SelectionMode } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { portalTargetId } from "../../cards/portal";
import { useUiStore } from "../../store/useUiStore";
import { edgeTypes } from "../EdgeDescription";
import { AboveLinkLayer } from "../links/AboveLinkLayer";
import { useLinkThreadStore } from "../links/linkThread";
import { ModeControl } from "../links/ModeControl";
import { SectionLinkLayer } from "../links/SectionLinkLayer";
import { LocalDragEase, prefersReducedMotion } from "../localEasing";
import { nodeTypes } from "../NoteNode";
import { PeerLibraryDragLayer } from "../PeerLibraryDragLayer";
import { PortalNode } from "../PortalNode";
import { PurposeControl } from "../PurposeControl";
import { PeerReconnectLayer } from "../presence/PeerReconnectLayer";
import { PresenceLayer } from "../presence/PresenceLayer";
import { SectionLayer } from "../sections/SectionLayer";
import type { usePlacementEngine } from "../usePlacementEngine";
import { WhiteboardNode } from "../WhiteboardNode";
import { ZOOM_MAX, ZOOM_MIN } from "../zoomRange";
import { DRAG_THROTTLE_MS, isEditorTarget } from "./boardSupport";
import type { useBoardCamera } from "./useBoardCamera";
import type { useBoardCommands } from "./useBoardCommands";
import type { useBoardLinks } from "./useBoardLinks";
import type { useBoardNodes } from "./useBoardNodes";
import type { useBoardProjection } from "./useBoardProjection";
import type { useBoardRefs } from "./useBoardRefs";
import type { useBoardSections } from "./useBoardSections";
import type { useBoardSelection } from "./useBoardSelection";
import type { useBoardUi } from "./useBoardUi";

/** React Flow node types; a portal card paints its target instead of a note. */
const canvasNodeTypes = { ...nodeTypes, portal: PortalNode, whiteboard: WhiteboardNode };

/**
 * The most a fit may magnify. Fitting frames what is on the board; it does not
 * zoom in to fill the screen with two cards.
 */
const FIT_MAX_ZOOM = 1;

type BoardSurfaceProps = {
  ui: ReturnType<typeof useBoardUi>;
  refs: ReturnType<typeof useBoardRefs>;
  projection: ReturnType<typeof useBoardProjection>;
  sections: ReturnType<typeof useBoardSections>;
  nodesApi: ReturnType<typeof useBoardNodes>;
  selection: ReturnType<typeof useBoardSelection>;
  links: ReturnType<typeof useBoardLinks>;
  camera: ReturnType<typeof useBoardCamera>;
  commands: ReturnType<typeof useBoardCommands>;
  placementEngine: ReturnType<typeof usePlacementEngine>;
};

/**
 * The React Flow surface and everything drawn inside it. It owns no state: every
 * value and handler arrives from the board's hooks, so a layer can be read on its
 * own without knowing how the board works.
 */
export function BoardSurface({
  ui,
  refs,
  projection,
  sections,
  nodesApi,
  selection,
  links,
  camera,
  commands,
  placementEngine,
}: BoardSurfaceProps) {
  const {
    workspace,
    activeBoardId,
    peers,
    setDragging,
    selectedSectionId,
    presenting,
    editingSectionId,
    setEditingSection,
    selectedEdgeIds,
    setSelectedEdgeIds,
    setSelectedConnector,
    openContextMenu,
    canEditContent,
    canEditLayout,
    canCreateContent,
    canManageTrash,
    canManageStructure,
    screenToFlowPosition,
    recordBoardViewport,
    openCardFocus,
  } = ui;
  const {
    locallyDraggingIds,
    draggedNodeIds,
    lastDragSent,
    marqueeActive,
    marqueeScope,
    marqueeBox,
    marqueePress,
    localEase,
    sectionLinkSelection,
  } = refs;
  const { cardsById, boardSections, projectedLinks, sectionMembershipMap } = projection;
  const {
    selectedSectionConnector,
    setSelectedSectionConnector,
    sectionOffsetsMap,
    sectionResizes,
    dimmedSectionIds,
    handleSelectSection,
    handleSectionDrag,
    handleSectionDragEnd,
    handleSectionResize,
    handleSectionResizeEnd,
    handleSectionRename,
  } = sections;
  const {
    nodes,
    edges,
    setNodes,
    onNodesChange,
    onEdgesChange,
    liveSelectedIds,
    applyBoardNodes,
    stopLocalEase,
    runLocalEase,
  } = nodesApi;
  const { endMarquee } = selection;
  const {
    threadStepAt,
    revealState,
    startEdgeDescription,
    resolveLinkTarget,
    onSectionLinkCommit,
    onConnect,
    onConnectStart,
    onConnectEnd,
    onReconnect,
    onReconnectStart,
    onReconnectStop,
  } = links;
  const { enterPortal, readCameraGesture, gestureStartZoom } = camera;
  const { commitDrop } = commands;

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={canvasNodeTypes}
      edgeTypes={edgeTypes}
      // Unmount nodes and edges outside the viewport. React Flow keeps measured
      // sizes and handle bounds for unmounted nodes, so edges still route and
      // connectors remeasure when a card scrolls back in.
      onlyRenderVisibleElements
      fitView
      fitViewOptions={{ maxZoom: FIT_MAX_ZOOM }}
      // The camera reaches far enough out to read a whole board and far enough
      // in to work on one card. Presenting is unclamped, because a tour step
      // asks for the viewport that frames what it is talking about
      // (ADR-0051 §9).
      minZoom={presenting ? 0 : ZOOM_MIN}
      maxZoom={presenting ? Number.POSITIVE_INFINITY : ZOOM_MAX}
      deleteKeyCode={null}
      // Selection, panning, zoom and the inspector stay for every role.
      // Layout writes follow the session capabilities: an editor share may
      // move and reconnect what exists, but never draw a new link.
      nodesDraggable={canEditLayout}
      nodesConnectable={canCreateContent}
      edgesReconnectable={canEditLayout}
      // Shift, Ctrl and Cmd all toggle membership; Shift also starts the
      // marquee (React Flow's `selectionKeyCode` default). `Partial` selects a
      // card the box merely touches, which is what a card board should do.
      multiSelectionKeyCode={["Meta", "Control", "Shift"]}
      selectionMode={SelectionMode.Partial}
      onSelectionStart={() => {
        marqueeBox.current = null;
        const press = marqueePress.current;
        const inside = press ? sectionsAt(press, boardSections)[0] : undefined;
        marqueeScope.current = inside ? { sectionId: inside.id } : null;
        // Applied here rather than on the first box frame: by then React Flow
        // has already committed a selection, and a card caught by that frame
        // stays caught. Flag writes only, so the live box is untouched; the
        // commit filters again in case a frame slipped through.
        if (inside) applyBoardNodes([...liveSelectedIds()], true);
        marqueeActive.current = true;
      }}
      onSelectionEnd={() => {
        // React Flow's final selection is authoritative; `endMarquee` releases
        // the guard and reconciles the store with it.
        endMarquee();
      }}
      connectionMode={ConnectionMode.Loose}
      // The layer itself rises while an edge is selected (see `.react-flow__edges`
      // in global.css); React Flow must not also raise the edge per element, or a
      // selected link keeps a 20px hit stroke over the cards once deselected.
      elevateEdgesOnSelect={false}
      onConnect={onConnect}
      onConnectStart={onConnectStart}
      onConnectEnd={onConnectEnd}
      onReconnect={onReconnect}
      onReconnectStart={onReconnectStart}
      onReconnectEnd={onReconnectStop}
      onEdgeContextMenu={(event, edge) => {
        if (!canEditLayout) return;
        event.preventDefault();
        openContextMenu({ x: event.clientX, y: event.clientY, kind: "edge", edgeId: edge.id });
      }}
      onEdgeClick={(event) => {
        setSelectedConnector(null);
        setSelectedSectionConnector(null);
        // A plain click replaces the selection; a modified one adds to it.
        if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
          sectionLinkSelection.current = [];
        }
      }}
      onNodeDoubleClick={(event, node) => {
        // A portal is a doorway: the camera transition replaces the board in
        // place. Any other card opens the full-canvas focus surface.
        const targetBoardId = portalTargetId(cardsById.get(node.id));
        if (targetBoardId) {
          event.preventDefault();
          enterPortal(node.id, targetBoardId);
          return;
        }
        openCardFocus(node.id);
      }}
      onMoveStart={(_event, viewport) => {
        gestureStartZoom.current = viewport.zoom;
      }}
      onMoveEnd={(_event, viewport) => {
        if (activeBoardId) recordBoardViewport(activeBoardId, viewport);
        readCameraGesture(gestureStartZoom.current ?? viewport.zoom, viewport.zoom);
      }}
      onEdgeDoubleClick={(event, edge) => {
        if (!canEditLayout) return;
        event.preventDefault();
        startEdgeDescription(edge.id, { x: event.clientX, y: event.clientY });
      }}
      onNodeDragStart={(_, node, dragged) => {
        if (!canEditLayout) return;
        // React Flow drags the whole selection; the node under the pointer is
        // the anchor peers derive every other member's position from.
        const ids = dragged.length > 0 ? dragged.map((entry) => entry.id) : [node.id];
        draggedNodeIds.current = ids;
        locallyDraggingIds.current = new Set(ids);
        // The rendered delta is eased from here to drop. Reduced motion keeps
        // the pre-A10 behaviour: paint the pointer sample directly.
        if (prefersReducedMotion()) stopLocalEase();
        else {
          const ease = new LocalDragEase();
          ease.begin(
            (dragged.length > 0 ? dragged : [node]).map((entry) => ({
              id: entry.id,
              position: entry.position,
            })),
            performance.now(),
          );
          localEase.current = ease;
        }
        setDragging({ nodeId: node.id, position: node.position, nodeIds: ids });
      }}
      onNodeDrag={(_, node) => {
        if (!canEditLayout) return;
        localEase.current?.target(node.id, node.position);
        if (localEase.current) runLocalEase();
        const now = performance.now();
        if (now - lastDragSent.current < DRAG_THROTTLE_MS) return;
        lastDragSent.current = now;
        setDragging({
          nodeId: node.id,
          position: node.position,
          nodeIds: draggedNodeIds.current,
        });
      }}
      onNodeDragStop={(_, node, dragged) => {
        if (!canEditLayout) return;
        const dropped = dragged.length > 0 ? dragged : [node];
        // The pointer position is the truth: land the render on it and paint
        // it before the one commit, so the drop never lingers a frame behind.
        const droppedAt = localEase.current?.finish();
        stopLocalEase();
        if (droppedAt && droppedAt.size > 0) {
          setNodes((current) =>
            current.map((entry) => {
              const position = droppedAt.get(entry.id);
              return position ? { ...entry, position, dragging: false } : entry;
            }),
          );
        }
        draggedNodeIds.current = [];
        locallyDraggingIds.current = new Set();
        setDragging(null);
        commitDrop(dropped);
      }}
      onPaneClick={() => {
        const thread = useLinkThreadStore.getState();
        if (performance.now() - Math.max(threadStepAt.current, thread.armedAt) > 300) {
          thread.clear();
        }
        setSelectedConnector(null);
        setSelectedSectionConnector(null);
        handleSelectSection(null);
        // Empty canvas closes the drawer: nothing is selected any more. A
        // section link is not a React Flow edge, so React Flow cannot clear it
        // for us — that is why selecting one used to be a trap.
        sectionLinkSelection.current = [];
        useUiStore.getState().setSelectedEdgeIds([]);
        useUiStore.getState().closeContainerInspector();
      }}
      onNodeClick={() => {
        // React Flow also reports a connector press as a node click, so this
        // must not undo the arm that press just made.
        const thread = useLinkThreadStore.getState();
        if (performance.now() - Math.max(threadStepAt.current, thread.armedAt) > 300) {
          thread.clear();
        }
        setSelectedConnector(null);
        setSelectedSectionConnector(null);
        handleSelectSection(null);
      }}
      onNodeContextMenu={(event, node) => {
        if (!canEditContent && !canEditLayout && !canManageTrash && !canManageStructure) return;
        // Rich text keeps the browser's own menu (copy, paste, spelling).
        // Chips inside the editor stop propagation before this handler.
        if (isEditorTarget(event)) return;
        event.preventDefault();
        openContextMenu({
          x: event.clientX,
          y: event.clientY,
          kind: "node",
          nodeId: node.id,
          // Lets "New section from N cards" fall back to the card it was
          // opened on when no card is selected.
          flowPosition: node.position,
        });
      }}
      onPaneContextMenu={(event) => {
        if (!canCreateContent) return;
        event.preventDefault();
        const flowPosition = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        openContextMenu({ x: event.clientX, y: event.clientY, kind: "canvas", flowPosition });
      }}
      // A marquee leaves React Flow's selection overlay over the cards, so a
      // right-click there reaches this handler rather than the card's.
      onSelectionContextMenu={(event, selected) => {
        if (
          (!canEditContent && !canEditLayout && !canManageTrash && !canManageStructure) ||
          isEditorTarget(event)
        ) {
          return;
        }
        event.preventDefault();
        const anchor = selected[0];
        if (!anchor) return;
        openContextMenu({
          x: event.clientX,
          y: event.clientY,
          kind: "node",
          nodeId: anchor.id,
          flowPosition: anchor.position,
        });
      }}
    >
      <SectionLayer
        sections={boardSections}
        dimmedSectionIds={dimmedSectionIds}
        membership={sectionMembershipMap}
        offsets={sectionOffsetsMap}
        resizes={sectionResizes}
        peers={peers}
        selectedSectionId={selectedSectionId}
        editingSectionId={editingSectionId}
        onSelect={handleSelectSection}
        onStartRename={setEditingSection}
        onCommitRename={handleSectionRename}
        onCancelRename={() => setEditingSection(null)}
        onDrag={handleSectionDrag}
        onDragEnd={handleSectionDragEnd}
        onResize={handleSectionResize}
        onResizeEnd={handleSectionResizeEnd}
        readOnly={!canEditLayout}
        onContextMenu={(event, sectionId) => {
          if (!canEditLayout) return;
          event.preventDefault();
          openContextMenu({
            x: event.clientX,
            y: event.clientY,
            kind: "section",
            sectionId,
          });
        }}
        chaining={revealState.chaining}
        draftActive={revealState.draftActive}
        armed={revealState.armed}
        selectedConnector={selectedSectionConnector}
        onConnectorSelect={(sectionId, connectorId) => {
          setSelectedSectionConnector({ sectionId, connectorId });
          setSelectedConnector(null);
        }}
        onConnectorMoveEnd={(sectionId, connectorId, position) => {
          if (!canManageStructure) return;
          workspace.moveSectionConnector(sectionId, connectorId, position);
        }}
        onConnectorContextMenu={(event, sectionId, connectorId) => {
          if (!canManageStructure) return;
          openContextMenu({
            x: event.clientX,
            y: event.clientY,
            kind: "connector",
            sectionId,
            connectorId,
          });
        }}
        resolveLinkTarget={resolveLinkTarget}
        onLinkCommit={onSectionLinkCommit}
        onReconnectEnd={(edgeId, end, sectionId, connectorId) => {
          workspace.reconnectEdge(edgeId, end, sectionId, connectorId, "section");
        }}
      />
      <AboveLinkLayer
        links={projectedLinks.above}
        selectedEdgeIds={new Set(selectedEdgeIds)}
        onSelectEdge={(edgeId, additive = false) => {
          setSelectedConnector(null);
          setSelectedSectionConnector(null);
          if (additive) {
            const current = sectionLinkSelection.current;
            sectionLinkSelection.current = current.includes(edgeId)
              ? current.filter((id) => id !== edgeId)
              : [...current, edgeId];
          } else {
            sectionLinkSelection.current = [edgeId];
          }
          setSelectedEdgeIds(sectionLinkSelection.current);
        }}
        onEdgeContextMenu={(event, edgeId) => {
          if (!canEditLayout) return;
          event.preventDefault();
          openContextMenu({ x: event.clientX, y: event.clientY, kind: "edge", edgeId });
        }}
      />
      <SectionLinkLayer
        links={projectedLinks.sections}
        selectedEdgeIds={new Set(selectedEdgeIds)}
        onSelectEdge={(edgeId, additive = false) => {
          setSelectedConnector(null);
          setSelectedSectionConnector(null);
          if (additive) {
            const current = sectionLinkSelection.current;
            sectionLinkSelection.current = current.includes(edgeId)
              ? current.filter((id) => id !== edgeId)
              : [...current, edgeId];
          } else {
            sectionLinkSelection.current = [edgeId];
          }
          const flowEdgeIds = selectedEdgeIds.filter(
            (id) => !sectionLinkSelection.current.includes(id) && id !== edgeId,
          );
          setSelectedEdgeIds(
            additive
              ? [...new Set([...flowEdgeIds, ...sectionLinkSelection.current])]
              : [...sectionLinkSelection.current],
          );
        }}
        onEdgeContextMenu={(event, edgeId) => {
          if (!canEditLayout) return;
          openContextMenu({ x: event.clientX, y: event.clientY, kind: "edge", edgeId });
        }}
        onReconnect={(edgeId, end, point) => {
          if (!canEditLayout) return;
          const target = resolveLinkTarget(point);
          if (!target) return;
          workspace.reconnectEdge(edgeId, end, target.id, target.connectorId, target.kind);
        }}
        toFlow={(client) => screenToFlowPosition(client)}
      />
      <Background color="var(--rf-dot)" />
      <Controls showInteractive={false}>
        <ModeControl engine={placementEngine} />
        <PurposeControl />
      </Controls>
      <PresenceLayer />
      <PeerReconnectLayer />
      <PeerLibraryDragLayer />
    </ReactFlow>
  );
}
