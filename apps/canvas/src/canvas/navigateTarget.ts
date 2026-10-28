import type { Board, Card, GraphEdge, Placement, Section, Target } from "@suite/graph";
import { useCallback } from "react";
import { portalTargetId } from "../cards/portal";
import type { WorkspaceSnapshot } from "../hooks/snapshotMerge";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";

/** The world a navigation is planned against: document state plus open boards. */
export interface NavigationScene {
  /** Board the user is on, or null before the first board is activated. */
  activeBoardId: string | null;
  boards: readonly Pick<Board, "id">[];
  cards: readonly Pick<Card, "id">[];
  placements: readonly Pick<Placement, "boardId" | "cardId">[];
  sections: readonly Pick<Section, "id" | "boardId">[];
  edges: readonly Pick<GraphEdge, "id" | "boardId">[];
  /**
   * Target board id → the portal card that opens it. Only portals on the active
   * board belong here: a doorway elsewhere cannot be flown through from here.
   */
  portals: ReadonlyMap<string, string>;
}

interface BoardStep {
  boardId: string;
  /** True when the caller must activate the board before the action. */
  switchBoard: boolean;
}

/**
 * What a navigation will do, decided without touching the stores. `null` means
 * the target is not reachable from here — resolution fails quietly rather than
 * navigating out of scope (ADR-0044).
 */
export type NavigationPlan =
  | ({ kind: "card"; cardId: string } & BoardStep)
  | {
      kind: "board";
      boardId: string;
      /** Portal card on the active board that opens it, for the camera doorway. */
      viaPortal: string | null;
    }
  | ({ kind: "section"; sectionId: string } & BoardStep)
  | ({ kind: "link"; edgeId: string } & BoardStep);

function hasBoard(scene: NavigationScene, boardId: string): boolean {
  return scene.boards.some((board) => board.id === boardId);
}

function boardStep(scene: NavigationScene, boardId: string): BoardStep {
  return { boardId, switchBoard: scene.activeBoardId !== boardId };
}

/**
 * The placement to navigate to when a card is on several boards: the active one
 * wins, so a "goto" on the board in front of you never jumps away for no reason.
 */
function placementFor(
  scene: NavigationScene,
  cardId: string,
): Pick<Placement, "boardId" | "cardId"> | undefined {
  const placements = scene.placements.filter((placement) => placement.cardId === cardId);
  return placements.find((placement) => placement.boardId === scene.activeBoardId) ?? placements[0];
}

/**
 * Resolves a target to the board switch and camera action that lands on it.
 * Pure: it reads the scene it is handed and reports what the caller should do.
 */
export function planNavigation(target: Target, scene: NavigationScene): NavigationPlan | null {
  switch (target.kind) {
    case "card": {
      if (!scene.cards.some((card) => card.id === target.id)) return null;
      const placement = placementFor(scene, target.id);
      if (!placement || !hasBoard(scene, placement.boardId)) return null;
      return { kind: "card", cardId: target.id, ...boardStep(scene, placement.boardId) };
    }
    case "board": {
      if (target.id === scene.activeBoardId) {
        return { kind: "board", boardId: target.id, viaPortal: null };
      }
      const portalCardId = scene.activeBoardId ? scene.portals.get(target.id) : undefined;
      if (portalCardId) return { kind: "board", boardId: target.id, viaPortal: portalCardId };
      if (!hasBoard(scene, target.id)) return null;
      return { kind: "board", boardId: target.id, viaPortal: null };
    }
    case "section": {
      const section = scene.sections.find((candidate) => candidate.id === target.id);
      if (!section || !hasBoard(scene, section.boardId)) return null;
      return { kind: "section", sectionId: section.id, ...boardStep(scene, section.boardId) };
    }
    case "link": {
      const edge = scene.edges.find((candidate) => candidate.id === target.id);
      if (!edge || !hasBoard(scene, edge.boardId)) return null;
      return { kind: "link", edgeId: edge.id, ...boardStep(scene, edge.boardId) };
    }
  }
}

/** Builds the resolver's scene from the shared snapshot. */
function sceneFor(snapshot: WorkspaceSnapshot, activeBoardId: string | null): NavigationScene {
  const cards = new Map(snapshot.cards.map((card) => [card.id, card]));
  const portals = new Map<string, string>();
  if (activeBoardId) {
    for (const placement of snapshot.placements) {
      if (placement.boardId !== activeBoardId) continue;
      const targetBoardId = portalTargetId(cards.get(placement.cardId));
      if (targetBoardId) portals.set(targetBoardId, placement.cardId);
    }
  }
  return {
    activeBoardId,
    boards: snapshot.boards,
    cards: snapshot.cards,
    placements: snapshot.placements,
    sections: snapshot.sections,
    edges: snapshot.edges,
    portals,
  };
}

/**
 * Performs a navigation. Returns false when the target cannot be reached from
 * here; unreachable targets (another share's card, a deleted board) fail
 * quietly — a Goto that silently does nothing beats one that throws.
 */
export function useNavigateTarget(): (target: Target) => boolean {
  const snapshot = useWorkspaceSnapshot();
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const activateBoard = useUiStore((state) => state.activateBoard);
  const focusCard = useUiStore((state) => state.focusCard);
  const focusSection = useUiStore((state) => state.focusSection);
  const setSelectedEdgeIds = useUiStore((state) => state.setSelectedEdgeIds);
  const requestPortalOpen = useUiStore((state) => state.requestPortalOpen);

  return useCallback(
    (target: Target): boolean => {
      const plan = planNavigation(target, sceneFor(snapshot, activeBoardId));
      if (!plan) return false;
      switch (plan.kind) {
        case "board": {
          if (plan.viaPortal) requestPortalOpen(plan.viaPortal, plan.boardId);
          else activateBoard(plan.boardId);
          return true;
        }
        case "card": {
          if (plan.switchBoard) activateBoard(plan.boardId);
          focusCard(plan.cardId, plan.boardId);
          return true;
        }
        case "section": {
          if (plan.switchBoard) activateBoard(plan.boardId);
          focusSection(plan.sectionId, plan.boardId);
          return true;
        }
        case "link": {
          if (plan.switchBoard) activateBoard(plan.boardId);
          setSelectedEdgeIds([plan.edgeId]);
          return true;
        }
      }
    },
    [
      activeBoardId,
      activateBoard,
      focusCard,
      focusSection,
      requestPortalOpen,
      setSelectedEdgeIds,
      snapshot,
    ],
  );
}

/** Anything carrying a presence `focus`; `PeerPresence` fits. */
export interface FocusSource {
  focus: { nodeId: string; field?: "title" | "body" } | null;
}

/**
 * The target a peer's caret names. Presence still publishes a node id rather
 * than a target (ADR-0044's refactor is additive), so this is the one place the
 * two shapes meet.
 */
export function targetOfFocus(peer: FocusSource | null): Target | null {
  const nodeId = peer?.focus?.nodeId;
  return nodeId ? { kind: "card", id: nodeId } : null;
}
