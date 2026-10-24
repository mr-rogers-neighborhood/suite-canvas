/**
 * Suite owns the selection; ICE is the canvas.
 *
 * The engine's `Selected` set is read once per frame and mirrored into the
 * shell's store. The first non-empty selection wins, and a shell-driven
 * selection is not cleared just because ICE has not selected anything yet.
 *
 * A single pick is also a request to *read* the card: the landing plan decides
 * whether this seat may open a reading surface at all, and the share decides
 * whether it may see this card. A viewer keeps the selection; the inspector
 * simply does not open.
 */

import { useEffect } from "react";

import { getSession } from "../session/session";
import { useUiStore } from "../store/useUiStore";
import { planCardLanding } from "./iceSelectionLanding";
import { withinShareScope } from "./iceShareCaps";
import type { IceWiring } from "./iceSurfaceWiring";

export function useIceSelection(wiring: IceWiring): void {
  const { phase, seed } = wiring;
  const { canEditContent, canOpenInspector } = wiring.caps;

  // ICE is the canvas, but Suite owns the selection. Read the engine's
  // `Selected` set once per frame and mirror it into the shell. The first
  // non-empty selection wins; a shell-driven selection is not cleared just
  // because ICE has not selected anything yet.
  useEffect(() => {
    if (phase.kind !== "ready" || seed === null || seed.entitySlots.size === 0) return;
    let handle = 0;
    let previous = "";
    const tick = (): void => {
      const selected = phase.core
        .selectedEntities(phase.engine.world)
        .map((entity) => seed.entitySlots.get(entity)?.cardId)
        .filter((cardId): cardId is string => cardId !== undefined);
      const key = selected.join("\u001f");
      if (key !== previous && (selected.length > 0 || previous.length > 0)) {
        previous = key;
        const store = useUiStore.getState();
        store.setSelectedNodeIds(selected);
        // Selecting one card is a request to read it: the inspector is the
        // shell's reading surface, so a single pick opens it directly rather
        // than needing a second gesture. Nothing closes it here — the panel
        // keeps its subject until the user closes it or the card goes away,
        // which is how the shell already behaved.
        const only = selected.length === 1 ? selected[0] : undefined;
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
