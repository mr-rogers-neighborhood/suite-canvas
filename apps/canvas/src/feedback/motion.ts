import { useEffect, useState } from "react";
import { prefersReducedMotion } from "../canvas/localEasing";

/**
 * Reduced motion, as the app defines it: the OS setting or the Appearance
 * preference that writes `data-motion` on the document root.
 *
 * `prefersReducedMotion()` already reads both (a stylesheet can only see the
 * media query). This hook adds what CSS cannot do on its own: re-render when the
 * reader flips either switch while a toast is on screen.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    const update = () => setReduced(prefersReducedMotion());
    const media =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    media?.addEventListener("change", update);
    const observer = typeof MutationObserver === "function" ? new MutationObserver(update) : null;
    observer?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-motion"],
    });
    update();
    return () => {
      media?.removeEventListener("change", update);
      observer?.disconnect();
    };
  }, []);

  return reduced;
}
