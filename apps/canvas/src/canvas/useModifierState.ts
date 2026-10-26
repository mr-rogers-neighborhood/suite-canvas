import { useEffect, useState } from "react";
import { isTextEntry, type ModifierState, modifiersOf, NO_MODIFIERS } from "./modifierPreview";

/**
 * The modifiers held right now, for a control that paints them by re-rendering.
 *
 * The link tool deliberately does *not* use this: it paints its hint onto the DOM
 * from a ref, because a re-render mid-gesture is the one thing its hint must not
 * cause. A purpose button holds no gesture, so a re-render here costs a single
 * button and keeps the preview declarative.
 *
 * Events that belong to a text field are ignored — typing a capital letter is not
 * a mode — and a window blur clears everything, because a key released while the
 * window was in the background never arrives ([ADR-0066](../../../docs/decisions/0066-one-modifier-vocabulary-and-a-purpose-that-explains.md)).
 */
export function useModifierState(): ModifierState {
  const [held, setHeld] = useState<ModifierState>(NO_MODIFIERS);

  useEffect(() => {
    const sync = (event: KeyboardEvent) => {
      const next = isTextEntry(event) ? NO_MODIFIERS : modifiersOf(event);
      setHeld((current) =>
        current.shift === next.shift && current.ctrl === next.ctrl && current.alt === next.alt
          ? current
          : next,
      );
    };
    const release = () => setHeld(NO_MODIFIERS);

    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", release);
    };
  }, []);

  return held;
}
