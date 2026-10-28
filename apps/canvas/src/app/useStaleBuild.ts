import { useEffect, useState } from "react";
import { entryBundleOf, isStaleBuild, loadedEntry } from "./staleBuild";

/** How often a long-lived tab asks whether the server has moved on. */
const POLL_MS = 5 * 60 * 1000;

/**
 * Watches for a deploy that this tab has not picked up.
 *
 * Asking on mount covers the common case — a tab resumed hours later — and asking
 * when the tab becomes visible again is what makes it feel immediate without a
 * timer that fires while nobody is looking.
 */
export function useStaleBuild(): boolean {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const loaded = loadedEntry();
    if (loaded === null) return;
    let live = true;

    const check = async () => {
      try {
        const response = await fetch("/", { cache: "no-store" });
        if (!response.ok) return;
        const served = entryBundleOf(await response.text());
        if (live && isStaleBuild(loaded, served)) setStale(true);
      } catch {
        // Offline, or the host is restarting: the document still works, and a
        // reload prompt would be the only thing wrong with it.
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };

    const timer = window.setInterval(() => void check(), POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    void check();
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  return stale;
}
