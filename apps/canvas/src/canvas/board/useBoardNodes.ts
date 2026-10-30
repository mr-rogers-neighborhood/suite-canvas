import type { Card } from "@suite/graph";
import { sectionMovePlan } from "@suite/graph";
import type { Edge, Node, NodeChange } from "@xyflow/react";
import { useEdgesState, useNodesState } from "@xyflow/react";
import { useCallback, useEffect, useRef } from "react";
import type { cardMeta } from "../../cards/cardMeta";
import { resolveCardType } from "../../cards/cardTypes";
import { isPortalCard } from "../../cards/portal";
import { isWhiteboardCard } from "../../cards/whiteboard";
import { useUiStore } from "../../store/useUiStore";
import type { EdgeDescriptionData } from "../EdgeDescription";
import type { CardNodeData } from "../nodeData";
import { toFlowEdge } from "./boardSupport";
import type { useBoardProjection } from "./useBoardProjection";
import type { useBoardRefs } from "./useBoardRefs";
import type { useBoardUi } from "./useBoardUi";

/** Share of the remaining distance covered per frame when easing toward a peer's drag. */
const SMOOTHING = 0.22;

/** Card meta assumed for a card the snapshot has not derived yet. */
const EMPTY_META = { properties: [], tags: [] } as unknown as ReturnType<typeof cardMeta>;

/**
 * The flow nodes and edges React Flow holds. React Flow owns transient state
 * (drag position, selection); the CRDT owns the truth, and this hook re-derives
 * one from the other whenever either side changes.
 */
export function useBoardNodes(
  ui: ReturnType<typeof useBoardUi>,
  input: {
    refs: ReturnType<typeof useBoardRefs>;
    projection: ReturnType<typeof useBoardProjection>;
    cardOffsetsMap: Map<string, { dx: number; dy: number }>;
    labelHandlers: Pick<EdgeDescriptionData, "onLabelDrag" | "onLabelEdit">;
  },
) {
  const { store, peers, lens, selectedEdgeIds } = ui;
  const { refs, projection, cardOffsetsMap, labelHandlers } = input;
  // Reader state, read as values: a fold repaints the board, and it never
  // touches the document.
  const collapsedCards = useUiStore((state) => state.collapsedCards);
  const collapsedSections = useUiStore((state) => state.collapsedSections);
  const {
    boardCards,
    boardPlacements,
    boardSections,
    boardPlacementList,
    projectedLinks,
    typeMap,
    metaByCard,
    sectionMembershipMap,
  } = projection;
  const {
    locallyDraggingIds,
    locallyResizing,
    selectedKey,
    paintedSelection,
    pointerActive,
    marqueeActive,
    marqueeScope,
    localEase,
    localEaseFrame,
    peerTargets,
    smoothPositions,
    smoothingFrame,
    lastSmoothingTick,
  } = refs;

  const [nodes, setNodes, applyNodeChanges] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  /**
   * The selection React Flow holds right now. While a marquee is in flight this
   * is the only authority: the store echo arrives a frame late, and painting
   * that echo back over the pane is what cleared the box mid-gesture.
   */
  const liveSelectedIds = useCallback((): Set<string> => {
    const ids = new Set<string>();
    for (const node of store.getState().nodeLookup.values()) {
      if (node.selected) ids.add(node.id);
    }
    return ids;
  }, [store]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: gesture refs are stable, so listing them would only add noise.
  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      const ease = localEase.current;
      const applied: NodeChange<Node>[] = [];
      for (const change of changes) {
        if (change.type === "dimensions") {
          if (change.resizing) locallyResizing.current.add(change.id);
          else locallyResizing.current.delete(change.id);
          applied.push(change);
          continue;
        }
        // A local drag is eased by the frame loop, not by the pointer sample:
        // the sample only updates the target, so a burst of events cannot make
        // the card step and the CRDT is still written once, at drop.
        if (change.type === "position" && change.position && ease?.tracks(change.id)) {
          ease.target(change.id, change.position);
          continue;
        }
        applied.push(change);
      }
      if (applied.length > 0) applyNodeChanges(applied);
    },
    [applyNodeChanges],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: gesture refs are stable, so listing them would only add noise.
  const stopLocalEase = useCallback(() => {
    if (localEaseFrame.current !== null) cancelAnimationFrame(localEaseFrame.current);
    localEaseFrame.current = null;
    localEase.current = null;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: gesture refs are stable, so listing them would only add noise.
  const runLocalEase = useCallback(() => {
    if (localEaseFrame.current !== null) return;
    const tick = () => {
      localEaseFrame.current = null;
      const ease = localEase.current;
      if (!ease) return;
      const moved = ease.step(performance.now());
      if (moved.size > 0) {
        setNodes((current) =>
          current.map((node) => {
            const position = moved.get(node.id);
            return position ? { ...node, position, dragging: true } : node;
          }),
        );
      }
      if (ease.moving) localEaseFrame.current = requestAnimationFrame(tick);
    };
    localEaseFrame.current = requestAnimationFrame(tick);
  }, [setNodes]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: gesture refs are stable, so listing them would only add noise.
  const runSmoothing = useCallback(() => {
    const tick = () => {
      lastSmoothingTick.current = performance.now();
      let moving = false;
      for (const [id, target] of peerTargets.current) {
        const previous = smoothPositions.current.get(id) ?? target;
        const x = previous.x + (target.x - previous.x) * SMOOTHING;
        const y = previous.y + (target.y - previous.y) * SMOOTHING;
        const settled = Math.abs(target.x - x) < 0.5 && Math.abs(target.y - y) < 0.5;
        smoothPositions.current.set(id, settled ? { ...target } : { x, y });
        if (!settled) moving = true;
      }

      // Smoothing rebuilds node objects, and a rebuild that carries a stale
      // `selected` clears React Flow's live marquee selection. While the box is
      // open, paint the selection React Flow reports instead of the old value.
      // A marquee is React Flow's gesture: a rebuild here replaces its live
      // `selected` with ours and empties the box under the pointer. Peer motion
      // pauses for the length of the gesture and lands when it closes.
      if (marqueeActive.current) {
        smoothingFrame.current = moving ? requestAnimationFrame(tick) : null;
        return;
      }
      setNodes((current) =>
        current.map((node) => {
          const position = smoothPositions.current.get(node.id);
          if (!position) return node;
          if (position.x === node.position.x && position.y === node.position.y) return node;
          return { ...node, position };
        }),
      );

      smoothingFrame.current = moving ? requestAnimationFrame(tick) : null;
    };

    if (smoothingFrame.current !== null) return;
    smoothingFrame.current = requestAnimationFrame(tick);
  }, [setNodes]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: gesture refs are stable, so listing them would only add noise.
  const applyBoardNodes = useCallback(
    (
      reconciled?: readonly string[],
      /**
       * Paint during a marquee. Only the scoped-selection flag needs this: it
       * must change while the box is live, and the caller passes React Flow's
       * own selection so the rebuild does not clear the box. Every other caller
       * waits for the gesture to close.
       */
      duringGesture = false,
    ) => {
      // React Flow owns the board for the length of a marquee. Rebuilding the flow
      // nodes mid-gesture hands it a stale `selected` set and clears the box, so
      // the paint waits for the gesture to close and reconciles once, in `endMarquee`.
      if (marqueeActive.current && !duringGesture) return;
      // Computed once per pass: an unchanged key means React Flow's live selection
      // is the truth, a changed one means a surface asked for a different set.
      // While a press is down React Flow is processing that press, so the store's
      // key can only be the echo of the previous click: painting it now paints a
      // selection older than the one the pane already holds.
      const explicit = reconciled ? new Set(reconciled) : null;
      const pressed = explicit === null && pointerActive.current;
      const repaintSelection = !explicit && !pressed && selectedKey !== paintedSelection.current;
      if (!explicit) paintedSelection.current = selectedKey;
      setNodes((current) => {
        const byId = new Map(current.map((node) => [node.id, node]));
        // Paint order comes from the sorted board list; ranks are fractional, so
        // they cannot be used as CSS z-index values directly.
        return boardCards.flatMap((card: Card, layer) => {
          const placement = boardPlacements.get(card.id);
          if (!placement) return [];
          // A folded section hides its members: the frame is the whole of it.
          const sectionId = sectionMembershipMap.get(card.id);
          if (sectionId !== undefined && collapsedSections[sectionId] === true) return [];
          const collapsed = collapsedCards[card.id] === true;
          const existing = byId.get(card.id);
          const sectionOffset = cardOffsetsMap.get(card.id);
          const storedPosition = sectionOffset
            ? { x: placement.x + sectionOffset.dx, y: placement.y + sectionOffset.dy }
            : { x: placement.x, y: placement.y };
          const reflowPosition = refs.previewDisplacedCards.current.get(card.id);
          const position =
            existing &&
            (locallyDraggingIds.current.has(card.id) || locallyResizing.current.has(card.id))
              ? existing.position
              : (reflowPosition ?? smoothPositions.current.get(card.id) ?? storedPosition);
          const selected = explicit
            ? explicit.has(card.id)
            : repaintSelection
              ? selectedKey.split(",").includes(card.id)
              : existing?.selected === true;
          const type = resolveCardType(typeMap, card.primaryTypeId);
          const meta = metaByCard.get(card.id) ?? EMPTY_META;
          const previous = existing?.data as CardNodeData | undefined;
          // The lens is part of the card's visible state: a view applied or
          // cleared must repaint, and an unchanged card must keep its object.
          const dim = lens.view !== null && !lens.cardIds.has(card.id);
          const previousDim = previous?.dim === true;
          const previousCollapsed = previous?.collapsed === true;
          // Reuse the data object (and the node when nothing visible changed), so
          // a card that did not change does not re-render on a peer's edit.
          const data: CardNodeData =
            previous &&
            previous.card === card &&
            previous.placement === placement &&
            previous.type === type &&
            previous.meta === meta &&
            previousDim === dim &&
            previousCollapsed === collapsed
              ? previous
              : {
                  card,
                  placement,
                  type,
                  meta,
                  ...(dim ? { dim: true } : {}),
                  ...(collapsed ? { collapsed: true } : {}),
                };
          // A scoped marquee only boxes this section's cards. The flag has to be
          // part of the node this function builds, not a one-off `updateNode`:
          // every rebuild would otherwise hand React Flow a node that is
          // selectable again and the scope would leak mid-gesture.
          const scope = marqueeScope.current;
          const selectable = !scope || sectionMembershipMap.get(card.id) === scope.sectionId;

          const isDisplaced = refs.previewDisplacedCards.current.has(card.id);
          const baseClass = existing?.className?.replace("is-reflow-displaced", "").trim();
          const nodeClassName = isDisplaced
            ? `${baseClass ? `${baseClass} ` : ""}is-reflow-displaced`
            : baseClass;

          if (
            existing &&
            existing.data === data &&
            existing.selected === selected &&
            existing.selectable === selectable &&
            existing.zIndex === layer &&
            (existing.className ?? "") === (nodeClassName ?? "") &&
            existing.position.x === position.x &&
            existing.position.y === position.y
          ) {
            return [existing];
          }
          return [
            {
              id: card.id,
              type: isWhiteboardCard(card) ? "whiteboard" : isPortalCard(card) ? "portal" : "note",
              position: { x: position.x, y: position.y },
              selected,
              selectable,
              zIndex: layer,
              data,
              ...(nodeClassName ? { className: nodeClassName } : {}),
            } satisfies Node,
          ];
        });
      });
    },
    [
      boardCards,
      boardPlacements,
      selectedKey,
      typeMap,
      metaByCard,
      cardOffsetsMap,
      setNodes,
      lens,
      sectionMembershipMap,
      collapsedCards,
      collapsedSections,
    ],
  );

  useEffect(() => {
    applyBoardNodes();
  }, [applyBoardNodes]);

  // When placement coordinates change from CRDT transactions (e.g. remote layout
  // plans or drag commits), ensure that any in-flight smoothing positions and
  // reflow preview displacements are cleared for those cards so the authoritative
  // CRDT position takes over immediately without waiting for awareness cleanup.
  const lastPlacements = useRef(boardPlacements);
  // biome-ignore lint/correctness/useExhaustiveDependencies: gesture refs are stable
  useEffect(() => {
    let cleared = false;
    for (const [cardId, placement] of boardPlacements) {
      const prev = lastPlacements.current.get(cardId);
      if (prev && (prev.x !== placement.x || prev.y !== placement.y)) {
        if (smoothPositions.current.has(cardId)) {
          smoothPositions.current.delete(cardId);
          cleared = true;
        }
        if (refs.previewDisplacedCards.current.has(cardId)) {
          refs.previewDisplacedCards.current.delete(cardId);
          cleared = true;
        }
      }
    }
    lastPlacements.current = boardPlacements;
    if (cleared) applyBoardNodes();
  }, [boardPlacements, applyBoardNodes]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: gesture refs are stable, so listing them would only add noise.
  useEffect(() => {
    const next = new Map<string, { x: number; y: number }>();
    for (const peer of Object.values(peers)) {
      // A top or left resize moves the node, so its corner streams like a drag's.
      if (peer.dragging) {
        const { nodeId, position, nodeIds } = peer.dragging;
        next.set(nodeId, position);
        // A multi-drag streams the anchor only; every other member rides the
        // same delta from its stored placement, so the set moves as one piece.
        const anchorPlacement = boardPlacements.get(nodeId);
        if (nodeIds && nodeIds.length > 1 && anchorPlacement) {
          const dx = position.x - anchorPlacement.x;
          const dy = position.y - anchorPlacement.y;
          for (const id of nodeIds) {
            if (id === nodeId) continue;
            const placement = boardPlacements.get(id);
            if (!placement) continue;
            next.set(id, { x: placement.x + dx, y: placement.y + dy });
          }
        }
      } else if (peer.resizing?.position) next.set(peer.resizing.nodeId, peer.resizing.position);

      // A section drag moves its members; resolve the same plan locally so the
      // cards ease toward the peer's section instead of stepping.
      if (peer.sectionDrag) {
        const root = boardSections.find((section) => section.id === peer.sectionDrag?.sectionId);
        if (root) {
          const dx = peer.sectionDrag.position.x - root.x;
          const dy = peer.sectionDrag.position.y - root.y;
          const plan = sectionMovePlan(root.id, boardSections, boardPlacementList);
          for (const placement of plan.placements) {
            next.set(placement.cardId, {
              x: placement.x + dx,
              y: placement.y + dy,
            });
          }
        }
      }
    }
    peerTargets.current = next;

    // Drop smoothing state for gestures that ended so the CRDT value takes over.
    // The final document write can land before the gesture clears, so re-derive
    // instead of waiting for the next board change that may never come.
    let ended = false;
    for (const id of smoothPositions.current.keys()) {
      if (next.has(id)) continue;
      smoothPositions.current.delete(id);
      ended = true;
    }

    if (next.size > 0) runSmoothing();
    if (ended) applyBoardNodes();
  }, [peers, boardSections, boardPlacementList, boardPlacements, runSmoothing, applyBoardNodes]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: gesture refs are stable, so listing them would only add noise.
  useEffect(
    () => () => {
      if (smoothingFrame.current !== null) cancelAnimationFrame(smoothingFrame.current);
      if (localEaseFrame.current !== null) cancelAnimationFrame(localEaseFrame.current);
    },
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: gesture refs are stable, so listing them would only add noise.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (smoothingFrame.current === null || peerTargets.current.size === 0) return;
      if (performance.now() - lastSmoothingTick.current < 250) return;
      for (const [id, target] of peerTargets.current) smoothPositions.current.set(id, target);
      applyBoardNodes();
    }, 250);
    return () => window.clearInterval(timer);
  }, [applyBoardNodes]);

  useEffect(() => {
    const peerByEdge = new Map<string, string>();
    for (const peer of Object.values(peers)) {
      for (const edgeId of peer.selection?.edgeIds ?? []) {
        if (!peerByEdge.has(edgeId)) peerByEdge.set(edgeId, peer.user.color);
      }
    }

    const selectedEdges = new Set(selectedEdgeIds);

    // While a peer drags one end of a link, their dashed preview replaces it.
    const reconnecting = new Set<string>();
    for (const peer of Object.values(peers)) {
      if (peer.reconnect) reconnecting.add(peer.reconnect.edgeId);
    }

    const flowEdges: Edge[] = projectedLinks.flow.map((link) => {
      const flowEdge = toFlowEdge(
        link.edge,
        link,
        selectedEdges.has(link.edge.id),
        labelHandlers,
        peerByEdge.get(link.edge.id),
      );
      // An arrow leaves the lens when either endpoint does: a line to a card the
      // view excluded is context, not a result.
      const painted = link.offLens ? { ...flowEdge, className: "is-off-lens" } : flowEdge;
      return reconnecting.has(link.edge.id) ? { ...painted, hidden: true } : painted;
    });
    setEdges(flowEdges);
  }, [projectedLinks, peers, selectedEdgeIds, setEdges, labelHandlers]);
  return {
    nodes,
    edges,
    setNodes,
    setEdges,
    onNodesChange,
    onEdgesChange,
    liveSelectedIds,
    applyBoardNodes,
    stopLocalEase,
    runLocalEase,
    runSmoothing,
  };
}
