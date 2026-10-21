import { useEffect, useState } from "react";
import { useCanvasStore } from "../store/useCanvasStore";
import { type DocStats, readDocStats } from "./docStats";
import { countRender, perfEnabled, readRenderRates } from "./perf";

const ROWS = 14;
const RATES_MS = 500;
const STATS_MS = 800;

const STAT_ROWS: Array<{ key: Exclude<keyof DocStats, "bytes">; label: string }> = [
  { key: "boards", label: "boards" },
  { key: "cards", label: "cards" },
  { key: "placements", label: "placements" },
  { key: "edges", label: "edges" },
];

/** Dev-only readout of how often each canvas layer repaints, plus document size. */
export function PerfOverlay() {
  const workspace = useCanvasStore((state) => state.workspace);
  const [rates, setRates] = useState(() => readRenderRates());
  const [stats, setStats] = useState<DocStats | null>(null);

  useEffect(() => {
    if (!perfEnabled) return;
    const timer = setInterval(() => setRates(readRenderRates()), RATES_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!perfEnabled) return;
    const refresh = () => {
      if (!workspace) return;
      setStats(readDocStats(workspace));
    };
    refresh();
    const timer = setInterval(refresh, STATS_MS);
    return () => clearInterval(timer);
  }, [workspace]);

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
      {stats ? (
        <div className="mt-2 border-t border-white/20 pt-1" data-testid="perf-doc-stats">
          <div className="mb-1 flex justify-between opacity-60">
            <span>doc</span>
            <span data-testid="perf-doc-size">{`${(stats.bytes / 1024).toFixed(1)} kb`}</span>
          </div>
          {STAT_ROWS.map(({ key, label }) => (
            <div key={key} className="flex justify-between gap-2">
              <span data-testid="perf-stat-key" className="truncate">
                {label}
              </span>
              <span data-testid="perf-stat-value">{stats[key]}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
