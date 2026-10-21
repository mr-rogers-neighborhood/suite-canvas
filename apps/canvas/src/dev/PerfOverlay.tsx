import { useEffect, useState } from "react";
import { countRender, perfEnabled, readRenderRates } from "./perf";

const ROWS = 14;

/** Dev-only readout of how often each canvas layer repaints. */
export function PerfOverlay() {
  const [rates, setRates] = useState(() => readRenderRates());

  useEffect(() => {
    if (!perfEnabled) return;
    const timer = setInterval(() => setRates(readRenderRates()), 500);
    return () => clearInterval(timer);
  }, []);

  if (!perfEnabled) return null;
  countRender("overlay");

  return (
    <div className="pointer-events-none fixed bottom-20 left-3 z-[1000] w-56 rounded-lg bg-black/80 p-2 font-mono text-[10px] text-white/90 shadow-lg">
      <div className="mb-1 flex justify-between opacity-60">
        <span>renders/s</span>
        <span>1s window</span>
      </div>
      {rates.slice(0, ROWS).map((rate) => (
        <div key={rate.key} className="flex justify-between gap-2">
          <span data-testid="perf-key" className="truncate">
            {rate.key}
          </span>
          <span data-testid="perf-value">{rate.perSecond}</span>
        </div>
      ))}
    </div>
  );
}
