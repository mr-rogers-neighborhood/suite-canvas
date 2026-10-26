import type { Edge, Node } from "@xyflow/react";
import { useOnSelectionChange, useStore } from "@xyflow/react";
import { useCallback, useEffect, useRef } from "react";
import { segmentCrossesRect } from "../links/linkGeometry";
import { DRAG_THROTTLE_MS, leavesSection } from "./boardSupport";
import type { useBoardNodes } from "./useBoardNodes";
import type { useBoardProjection } from "./useBoardProjection";
import type { useBoardRefs } from "./useBoardRefs";
import type { useBoardUi } from "./useBoardUi";

/**
 * React Flow's marquee in screen pixels, as a normalised flow rectangle. Both
 * box consumers — the presence publish and the section-scope release — read it
 * from here, so they cannot disagree about the conversion at a zoom level.
 */
function flowBoxOf(
  screenToFlowPosition: (point: { x: number; y: number }) => { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const start = screenToFlowPosition({ x: rect.x, y: rect.y });
  const end = screenToFlowPosition({ x: rect.x + rect.width, y: rect.y + rect.height });
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

/**
 * Who is selected, and the marquee that decides it. React Flow owns the live
 * gesture; this hook keeps its guard flags honest, reconciles the store once per
 * gesture, and publishes the box and the selection to peers.
 */
export function useBoardSelection(
  ui: ReturnType<typeof useBoardUi>,
  input: {
    refs: ReturnType<typeof useBoardRefs>;
    projection: ReturnType<typeof useBoardProjection>;
    nodes: ReturnType<typeof useBoardNodes>;
  },
) {
  const {
    setSelectedNodeIds,
    setSelectedEdgeIds,
    setPresenceSelection,
    setSelectionBox,
    screenToFlowPosition,
    store,
    selectedConnector,
    selectedEdgeIds,
    selectedNodeIds,
    selectedSectionId,
  } = ui;
  const { refs, projection, nodes } = input;
  const { sectionMembershipMap, boardSections, projectedLinks } = projection;
  const { applyBoardNodes, liveSelectedIds } = nodes;
  const {
    boardRoot,
    pointerActive,
    marqueeActive,
    marqueeScope,
    marqueeBox,
    marqueePress,
    paintedSelection,
    sectionLinkSelection,
    lastBoxSent,
  } = refs;

  /**
   * Marks the length of a press. React Flow owns the selection while a pointer is
   * down, so `applyBoardNodes` keeps its live `selected` flags for that window
   * instead of repainting the store's last echo over them. Capture phase on
   * `pointerdown`, so the flag is up before React Flow's own handler runs.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: gesture refs are stable, so listing them would only add noise.
  useEffect(() => {
    const press = () => {
      pointerActive.current = true;
    };
    const release = () => {
      pointerActive.current = false;
    };
    window.addEventListener("pointerdown", press, true);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerdown", press, true);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);

  /**
   * Where the current press landed, in flow coordinates. A box is scoped to the
   * section that press was inside; `onSelectionStart` carries no position.
   */

  /**
   * While the selection key is held, a section stops swallowing the press: a
   * box can only start on the pane, and React Flow cannot see a press that lands
   * on the section layer at all (it is rendered through a portal, so the pane is
   * not its React ancestor). The flag is a DOM attribute rather than state — a
   * re-render of this board between keydown and click repaints the selection
   * from the store's last echo, which swallows a modifier click.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: gesture refs are stable, so listing them would only add noise.
  useEffect(() => {
    const root = boardRoot;
    const sync = (event: KeyboardEvent) => {
      if (event.shiftKey) root.current?.setAttribute("data-selection-key", "true");
      else root.current?.removeAttribute("data-selection-key");
    };
    const release = () => root.current?.removeAttribute("data-selection-key");
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", release);
    };
  }, []);

  /**
   * Gives every card back its `selectable` flag. React Flow only boxes nodes
   * that are selectable, so this is the only thing standing between the scope
   * and a permanently unselectable card.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: gesture refs are stable, so listing them would only add noise.
  const releaseMarqueeScope = useCallback(() => {
    if (!marqueeScope.current) return;
    marqueeScope.current = null;
    // Repaints with React Flow's own selection, so the box survives and every
    // card becomes boxable again the moment the scope lifts.
    applyBoardNodes([...liveSelectedIds()], true);
  }, [applyBoardNodes, liveSelectedIds]);

  /**
   * Releases the marquee guard on every termination path, not just the happy
   * one. React Flow reports `onSelectionEnd` when the box closes on its own; a
   * pointer released outside the pane or an Escape mid-gesture leaves the guard
   * up, and a stale guard freezes selection painting for the rest of the session.
   *
   * The final selection is React Flow's, so the store is reconciled once, here,
   * instead of on every pointer frame the box reports.
   */
  /** Section links a box covers. They are drawn by the canvas, so React Flow
   * never reports them; the box is what decides they are selected. */
  const sectionLinksInBox = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) =>
      projectedLinks.sections
        .filter((link) => segmentCrossesRect(link.anchors.source, link.anchors.target, rect))
        .map((link) => link.edge.id),
    [projectedLinks],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: gesture refs are stable, so listing them would only add noise.
  const endMarquee = useCallback(() => {
    const box = marqueeBox.current;
    marqueeBox.current = null;
    const boxedLinks = box ? sectionLinksInBox(box) : [];
    // The scope is enforced here as well as while the box is drawn. `selectable`
    // only stops a card React Flow has not picked up yet, and whether it lands
    // before the first box frame depends on gesture timing; the commit cannot be
    // timing-dependent, so a non-member is dropped from the result outright.
    const scope = marqueeScope.current;
    // React Flow clears its own selection state in the pane's pointerup handler,
    // which never runs when the pointer is released outside the pane or over a
    // panel. Left set, `userSelectionActive` keeps the pane in selection mode and
    // every later marquee neither paints nor selects, which is the "the page
    // broke" half of the report. This mirrors that handler for the paths it
    // cannot see, on every termination path and whether or not the guard below
    // is still up.
    store.setState((state) =>
      state.userSelectionRect || state.userSelectionActive
        ? { userSelectionRect: null, userSelectionActive: false }
        : state,
    );
    // Read React Flow's own selection *before* releasing the scope: releasing
    // rebuilds the nodes, and a rebuild paints the store's last echo over the
    // live selection (which is still empty at this point in the gesture).
    const live = [...liveSelectedIds()];
    releaseMarqueeScope();
    if (!marqueeActive.current) return;
    marqueeActive.current = false;
    const ids = scope
      ? live.filter((id) => sectionMembershipMap.get(id) === scope.sectionId)
      : live;
    // Set before the store write, so the repaint it causes sees an unchanged key
    // and keeps the selection this pass painted.
    paintedSelection.current = ids.join(",");
    setSelectedNodeIds(ids);
    applyBoardNodes(ids);
    // The marquee owns the selection: a box that crosses a section link picks it
    // up, and a box that crosses none drops the ones picked before.
    sectionLinkSelection.current = boxedLinks;
    const flowEdgeIds = store
      .getState()
      .edges.filter((edge) => edge.selected)
      .map((edge) => edge.id);
    setSelectedEdgeIds([...new Set([...flowEdgeIds, ...boxedLinks])]);
  }, [
    applyBoardNodes,
    liveSelectedIds,
    releaseMarqueeScope,
    sectionLinksInBox,
    sectionMembershipMap,
    setSelectedEdgeIds,
    setSelectedNodeIds,
    store,
  ]);

  // The listener effect must not re-subscribe when `endMarquee` changes: its
  // cleanup used to drop `marqueeActive`, so the first rebuild during a gesture
  // (a peer's presence tick, or the store echo of the first selection frame)
  // released the guard mid-drag. With the guard down, the store echo repainted
  // `selected` from a stale set and React Flow's own selection was overwritten.
  const endMarqueeRef = useRef(endMarquee);

  useEffect(() => {
    endMarqueeRef.current = endMarquee;
  }, [endMarquee]);

  useEffect(() => {
    const onPointerEnd = () => endMarqueeRef.current();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") endMarqueeRef.current();
    };
    // Bubble phase, so React Flow has finalised its selection on the same event.
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => () => setSelectionBox(null), [setSelectionBox]);

  // React Flow registers this handler in an effect keyed on its identity, and
  // unregisters it during the cleanup phase of every commit that re-renders this
  // board. An inline callback therefore misses any selection change that lands in
  // the same commit (the listener's own effect runs before this one re-registers),
  // so the callback has to stay stable.
  /**
   * Section links the user has selected. They are invisible to React Flow (a
   * section is not a node), so they need their own memory to survive the
   * selection reports that arrive for everything else.
   */

  // biome-ignore lint/correctness/useExhaustiveDependencies: gesture refs are stable, so listing them would only add noise.
  const onSelectionChanged = useCallback(
    ({ nodes: nextNodes, edges: nextEdges }: { nodes: Node[]; edges: Edge[] }) => {
      // A marquee reports every card it touches, frame by frame. Reconciling the
      // store on each echo re-renders the shell per pointer sample and
      // republishes presence mid-gesture; `endMarquee` reconciles once instead.
      if (marqueeActive.current) return;
      setSelectedNodeIds(nextNodes.map((node) => node.id));
      // A link that touches a section is drawn by the canvas, not by React Flow,
      // so it can never appear in this report. Keep the ones the user picked, or
      // the first unrelated selection change would silently drop them.
      const flowEdgeIds = nextEdges.map((edge) => edge.id);
      setSelectedEdgeIds([...new Set([...flowEdgeIds, ...sectionLinkSelection.current])]);
    },
    [setSelectedNodeIds, setSelectedEdgeIds],
  );

  useOnSelectionChange({ onChange: onSelectionChanged });

  // One publisher for everything a peer has selected, including the connector
  // they clicked, so no component has to reason about who else is selected.
  // biome-ignore lint/correctness/useExhaustiveDependencies: gesture refs are stable, so listing them would only add noise.
  useEffect(() => {
    // A gesture publishes its selection once, when the box closes; the box
    // itself travels through `setSelectionBox` below.
    if (marqueeActive.current) return;
    const connector = selectedConnector
      ? { nodeId: selectedConnector.nodeId, connectorId: selectedConnector.connectorId }
      : undefined;
    const hasSelection =
      selectedSectionId !== null ||
      selectedNodeIds.length > 0 ||
      selectedEdgeIds.length > 0 ||
      connector !== undefined;

    setPresenceSelection(
      hasSelection
        ? {
            nodeIds: selectedNodeIds,
            edgeIds: selectedEdgeIds,
            ...(connector ? { connector } : {}),
            ...(selectedSectionId ? { sectionId: selectedSectionId } : {}),
          }
        : null,
    );
  }, [
    selectedConnector,
    selectedEdgeIds,
    selectedNodeIds,
    selectedSectionId,
    setPresenceSelection,
  ]);

  // React Flow owns the marquee rectangle in screen space; publish it in flow
  // coordinates so peers draw the same gesture in the dragger's colour.
  const selectionRect = useStore((state) => state.userSelectionRect);
  // biome-ignore lint/correctness/useExhaustiveDependencies: gesture refs are stable, so listing them would only add noise.
  useEffect(() => {
    if (!selectionRect) {
      setSelectionBox(null);
      return;
    }
    const box = flowBoxOf(screenToFlowPosition, selectionRect);
    // Kept unthrottled: the closing gesture reads this, and a frame that lands
    // inside the throttle window is still part of the box the user drew.
    marqueeBox.current = box;
    const now = performance.now();
    if (now - lastBoxSent.current < DRAG_THROTTLE_MS) return;
    lastBoxSent.current = now;
    setSelectionBox(box);
  }, [selectionRect, screenToFlowPosition, setSelectionBox]);

  // The scope a box began under: every card outside the section loses its
  // `selectable` flag, which is what makes React Flow's own box skip it. The
  // flag is restored the frame the box grows past the section's frame, so a
  // sweep that leaves the section keeps selecting the rest of the board.
  // biome-ignore lint/correctness/useExhaustiveDependencies: gesture refs are stable, so listing them would only add noise.
  useEffect(() => {
    const scope = marqueeScope.current;
    if (!scope) return;
    if (!selectionRect || selectionRect.width === 0 || selectionRect.height === 0) return;
    const section = boardSections.find((entry) => entry.id === scope.sectionId);
    if (!section) {
      releaseMarqueeScope();
      return;
    }
    if (leavesSection(section, flowBoxOf(screenToFlowPosition, selectionRect))) {
      releaseMarqueeScope();
      return;
    }
  }, [selectionRect, boardSections, releaseMarqueeScope, screenToFlowPosition]);
  return { endMarquee, releaseMarqueeScope, marqueePress };
}
