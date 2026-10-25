import {
  isTutorialType,
  markTourRead,
  type Target,
  type TargetExistence,
  type TourStepViewport,
  tourStepsInContent,
  type WorkspaceDocument,
} from "@suite/graph";
import type { ContainerID, LoroDoc } from "loro-crdt";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore, type ViewportState } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";

/**
 * The app-side half of a tour (ADR-0058): what the graph cannot know because it
 * needs the document, and what only the DOM can answer because the overlay
 * measures rather than reaching into the renderer.
 *
 * A tutorial type is an ordinary type named `Tutorial`, created through the type
 * settings the workspace already has; nothing here mints schema behind the
 * author's back.
 */

/** Whether a card's primary type is a tutorial (ADR-0058: Details · Steps · Style). */
export function isTutorialPrimaryType(
  types: readonly { id: string; name: string }[],
  primaryTypeId: string,
): boolean {
  return isTutorialType(types.find((type) => type.id === primaryTypeId));
}

/** What still exists, in the one shape every dead-target check reads. */
export function targetExistence(workspace: WorkspaceDocument): TargetExistence {
  return {
    // A trashed card is gone for a reader: the tour keeps its viewport and shows
    // the tombstone instead of pointing at something they can no longer open.
    card: (id) => {
      const card = workspace.getCard(id);
      return card !== undefined && card.deletedAt == null;
    },
    board: (id) => workspace.getBoard(id) !== undefined,
    section: (id) => workspace.getSection(id) !== undefined,
    link: (id) => workspace.getEdge(id) !== undefined,
  };
}

/** A target named the way the reader knows it: a title, not an id. */
export function targetLabel(workspace: WorkspaceDocument, target: Target): string {
  switch (target.kind) {
    case "card":
      return workspace.displayTitle(target.id);
    case "board":
      return workspace.getBoard(target.id)?.name ?? "Missing board";
    case "section":
      return workspace.getSection(target.id)?.title.trim() || "Untitled section";
    case "link":
      return "Link";
  }
}

/**
 * A target's live label, or "Removed" once the thing it names is gone. The
 * snapshot subscription is the re-render: renaming the card a step points at
 * renames the step instead of leaving a stale badge.
 */
export function useTargetLabel(target: Target | null): string {
  const workspace = useCanvasStore((state) => state.workspace);
  const snapshot = useWorkspaceSnapshot();
  return useMemo(() => {
    if (!target) return "No target yet";
    // The snapshot is the trigger, not the source: titles live in containers.
    void snapshot;
    if (!targetExistence(workspace)[target.kind](target.id)) return "Removed";
    return targetLabel(workspace, target);
  }, [workspace, snapshot, target]);
}

/**
 * The camera a new step asks for: the one the author is looking at. Read from
 * the store instead of the renderer, which is why authoring needs no canvas
 * change (ADR-0058).
 */
export function currentViewport(): TourStepViewport | null {
  const state = useUiStore.getState();
  const boardId = state.activeBoardId;
  if (!boardId) return null;
  const viewport: ViewportState | undefined = state.boardViewports[boardId];
  return viewport ? { x: viewport.x, y: viewport.y, zoom: viewport.zoom } : null;
}

/**
 * The target under a pointer, read from the DOM the overlay also measures:
 * cards carry `data-node-id`, sections `data-testid="section-region-<id>"`
 * (ADR-0058 §7). A press inside a card's body still names the card.
 */
export function targetAtElement(element: Element | null): Target | null {
  const cardId = element?.closest("[data-node-id]")?.getAttribute("data-node-id");
  if (cardId) return { kind: "card", id: cardId };
  const testId = element?.closest('[data-testid^="section-region-"]')?.getAttribute("data-testid");
  if (testId) return { kind: "section", id: testId.slice("section-region-".length) };
  return null;
}

/**
 * Turns the next interface click into a `Target` (ADR-0054 §3).
 *
 * The listener sits in the capture phase on the document so the press never
 * reaches the canvas: arming a picker is authoring, and selecting the card it
 * points at would open that card instead of editing the step. Escape disarms; a
 * press on nothing targetable is ignored rather than counted, so the author can
 * pan to what they mean.
 */
export function useArmTargetPick(
  armed: boolean,
  onPick: (target: Target) => void,
  onCancel: () => void,
): void {
  useEffect(() => {
    if (!armed) return;
    const onClick = (event: MouseEvent) => {
      const target = targetAtElement(event.target instanceof Element ? event.target : null);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      onPick(target);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [armed, onPick, onCancel]);
}

/**
 * A counter that advances on every write to one Loro document.
 *
 * A step block lives in the card body, so a panel that lists blocks has to
 * re-read after an editor keystroke as well as after its own call: both arrive
 * as a commit on the workspace document, which is also the card document.
 */
export function useLoroVersion(doc: LoroDoc | null | undefined): number {
  const version = useRef(0);
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!doc) return () => {};
      return doc.subscribe(() => {
        version.current += 1;
        notify();
      });
    },
    [doc],
  );
  return useSyncExternalStore(
    subscribe,
    () => version.current,
    () => 0,
  );
}

/**
 * The reader reached the end: record it on the tutorial card and leave. A
 * completion is a workspace value, so a collaborator sees "read" and a reload
 * remembers (ADR-0054 §9); the overlay and the panel both finish here, because
 * "passed the last step" is one event with one record.
 */
export function completeTour(tutorialId: string): void {
  const workspace = useCanvasStore.getState().workspace;
  markTourRead(workspace, tutorialId);
  useUiStore.getState().closeTour();
}

/**
 * Whether one body container already holds a step block.
 *
 * This is the second way a card is a tutorial: an author who types `/step` has
 * started one, so the panel appears then, without them first going to the type
 * settings to mint a "Tutorial" type (ADR-0054 §1, ADR-0058 §1).
 */
export function hasTourSteps(
  doc: LoroDoc | null | undefined,
  contentId: ContainerID | null,
): boolean {
  if (!doc || contentId === null) return false;
  return tourStepsInContent(doc.getContainerById(contentId)).length > 0;
}
