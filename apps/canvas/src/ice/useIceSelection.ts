/**
 * Suite owns the selection; ICE is the canvas.
 *
 * The engine's `Selected` set is read once per frame and mirrored into the
 * shell's store. The first non-empty selection wins, and a shell-driven
 * selection is not cleared just because ICE has not selected anything yet.
 *
 * Both kinds of thing a link can be are in that set: a **card** — a placement's
 * entity, resolved through the seed's slots — and a **link** — a `suite.edge`,
 * resolved through the drawn-link table the surface already keeps. A link is
 * `selectable` on the desk, so ICE reports it like any other object; what was
 * missing was the shell half, which is why a picked link used to leave the store
 * holding an empty card selection and the link still looked unselected to every
 * consumer (presence, the menu, the keyboard).
 *
 * A single card pick is also a request to *read* the card: the landing plan
 * decides whether this seat may open a reading surface at all, and the share
 * decides whether it may see this card. A viewer keeps the selection; the
 * inspector simply does not open. A link is never read that way — it has no
 * body, only a description — so a link-only selection asks for nothing.
 */

import type { Entity } from "@vibecook/ice";
import { useEffect } from "react";

import { getSession } from "../session/session";
import { useUiStore } from "../store/useUiStore";
import { cardIdOf } from "./iceEntityIdentity";
import { planCardLanding } from "./iceSelectionLanding";
import { mirrorSelection, selectionChanged, selectionKey } from "./iceSelectionMirror";
import { withinShareScope } from "./iceShareCaps";
import type { IceWiring } from "./iceSurfaceWiring";
import { SUITE_EDGE_FACE } from "./suiteEdgeKind";

export function useIceSelection(wiring: IceWiring): void {
  const { phase, seed } = wiring;
  const { canEditContent, canOpenInspector } = wiring.caps;

  // ICE is the canvas, but Suite owns the selection. Read the engine's
  // `Selected` set once per frame and mirror it into the shell. The first
  // non-empty selection wins; a shell-driven selection is not cleared just
  // because ICE has not selected anything yet.
  useEffect(() => {
    if (phase.kind !== "ready" || seed === null || seed.entitySlots.size === 0) return;
    const world = phase.engine.world;
    /**
     * The link an entity draws, when the desk can say. A desk that has not
     * registered the link kind (a headless test's mock) answers nothing rather
     * than throwing: a selection mirror must never be the reason a canvas dies.
     */
    const edgeIdOf = (entity: Entity): string | undefined => {
      try {
        return world.get(entity, SUITE_EDGE_FACE)?.edgeId;
      } catch {
        return undefined;
      }
    };
    let handle = 0;
    let previous = "";
    const tick = (): void => {
      const entities = phase.core.selectedEntities(world);
      const selection = mirrorSelection({
        entities,
        // A pick inside an entered Board is an entity ICE made for that frame,
        // so the card it stands for comes from its own face, not from the
        // seed's table of what this surface spawned.
        cardOf: (entity) => seed.entitySlots.get(entity)?.cardId ?? cardIdOf(world, entity)?.cardId,
        // The link answers for itself: `suite.edge`'s own group carries the
        // workspace edge it draws, so a selected entity that is not a card is
        // a link exactly when it has that face.
        edgeOf: edgeIdOf,
      });
      const cards = selection.cards;
      const links = selection.edges;
      const key = selectionKey(selection);
      if (selectionChanged(previous, key)) {
        previous = key;
        const store = useUiStore.getState();
        store.setSelectedNodeIds([...cards]);
        store.setSelectedEdgeIds([...links]);
        // Selecting one card is a request to read it: the inspector is the
        // shell's reading surface, so a single pick opens it directly rather
        // than needing a second gesture. Nothing closes it here — the panel
        // keeps its subject until the user closes it or the card goes away,
        // which is how the shell already behaved.
        const only = cards.length === 1 && links.length === 0 ? cards[0] : undefined;
        if (only !== undefined && store.inspectorNodeId !== only) {
          // The shared landing plan decides whether a pick may open a reading
          // surface at all, and the share decides whether this seat may see this
          // card. A viewer keeps the selection; the panel just does not open.
          const landing = planCardLanding({
            cardId: only,
            created: false,
            canEditContent,
            readOnly: !canOpenInspector || !withinShareScope({ cardId: only }, getSession().share),
            hasPlacement: true,
          });
          if (landing.openInspector) store.openInspector(only);
        }
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [phase, seed, canEditContent, canOpenInspector]);
}
