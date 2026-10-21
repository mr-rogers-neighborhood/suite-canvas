import { useEffect, useRef, useState } from "react";

export interface Size {
  width: number;
  height: number;
}

const SMOOTHING = 0.3;

/**
 * Eases toward a peer's latest size, so a remote resize reads as motion instead
 * of stepping at the broadcast rate. Mirrors the card-drag smoothing.
 */
export function useSmoothedSize(target: Size | null): Size | null {
  const [size, setSize] = useState<Size | null>(target);
  const targetRef = useRef(target);
  const currentRef = useRef<Size | null>(target);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    targetRef.current = target;
    if (!target) {
      currentRef.current = null;
      setSize(null);
      return;
    }
    if (frame.current !== null) return;

    const tick = () => {
      const next = targetRef.current;
      if (!next) {
        frame.current = null;
        return;
      }
      const from = currentRef.current ?? next;
      const eased: Size = {
        width: from.width + (next.width - from.width) * SMOOTHING,
        height: from.height + (next.height - from.height) * SMOOTHING,
      };
      const settled =
        Math.abs(next.width - eased.width) < 0.5 && Math.abs(next.height - eased.height) < 0.5;
      currentRef.current = settled ? next : eased;
      setSize(currentRef.current);
      frame.current = settled ? null : requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
  }, [target]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return size;
}
