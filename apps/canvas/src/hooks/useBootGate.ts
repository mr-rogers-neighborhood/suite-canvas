import { useEffect, useRef, useState } from "react";

export interface BootGateOptions {
  /** Keep the loader on screen at least this long, even on a warm load. */
  minMs?: number;
  /** Fade-out duration before the loader unmounts. */
  exitMs?: number;
  /** Test seam; defaults to `performance.now`. */
  now?: () => number;
}

const defaultNow = () => performance.now();

export interface BootGate {
  show: boolean;
  exiting: boolean;
}

/**
 * Local hydration can finish before the browser has painted a stable frame.
 * Holding the loader for a short minimum avoids a one-frame flash, and the
 * exit phase lets the canvas appear under a fade instead of a hard cut.
 */
export function useBootGate(ready: boolean, options: BootGateOptions = {}): BootGate {
  const minMs = options.minMs ?? 520;
  const exitMs = options.exitMs ?? 180;
  const now = options.now ?? defaultNow;
  const startedAt = useRef(now());
  const [show, setShow] = useState(true);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (!ready || exiting) return;
    const remaining = Math.max(0, minMs - (now() - startedAt.current));
    const timer = setTimeout(() => setExiting(true), remaining);
    return () => clearTimeout(timer);
  }, [exiting, minMs, now, ready]);

  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => setShow(false), exitMs);
    return () => clearTimeout(timer);
  }, [exitMs, exiting]);

  return { show, exiting };
}
