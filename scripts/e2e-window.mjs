/**
 * Where a headed Chrome window should open.
 *
 * Playwright launches headed Chrome for the ICE specs because those tests need a
 * real WebGPU adapter, and an unpositioned window lands wherever the window
 * manager last put one — which on a multi-monitor desk is usually under the
 * cursor, interrupting whoever is working. This module picks a screen ONCE and
 * hands Chrome `--window-position` / `--window-size`, preferring a display that
 * is not the primary one so a test never covers what the developer is reading.
 *
 * Env overrides, both `X,Y` / `WxH`:
 *   SUITE_E2E_WINDOW_POSITION  e.g. `64,64`
 *   SUITE_E2E_WINDOW_SIZE      e.g. `1280x900`
 *
 * Deriving from `xrandr` keeps the choice portable across docks and resolutions;
 * when the query is unavailable (not Linux, no X server) the helpers return no
 * flags at all and Chrome behaves exactly as before.
 */

import { execFileSync } from "node:child_process";

/** The window a headed test opens at when nothing else says otherwise. */
export const DEFAULT_WINDOW_SIZE = { width: 1440, height: 900 };
/** Gap from the screen's edge, px. */
const INSET = 48;

/** Parse `xrandr --listmonitors` into rects; `[]` when the shape is unfamiliar. */
export function parseMonitors(output) {
  /** @type {Array<{x:number,y:number,width:number,height:number,primary:boolean}>} */
  const monitors = [];
  for (const line of output.split("\n")) {
    // ` 0: +*eDP-1 1920/382x1080/215+2304+0  eDP-1`
    const match = /^\s*\d+:\s+([+*]*)\S*\s+\d+\/\d+x\d+\/\d+([+-]\d+)([+-]\d+)/.exec(line);
    if (match === null) continue;
    const [, marks, x, y] = match;
    const size = /(\d+)\/\d+x(\d+)\/\d+[+-]\d+[+-]\d+/.exec(line);
    if (size === null) continue;
    monitors.push({
      x: Number(x),
      y: Number(y),
      width: Number(size[1]),
      height: Number(size[2]),
      primary: marks.includes("*"),
    });
  }
  return monitors;
}

/** The monitors on this machine, or `[]` when they cannot be queried. */
export function monitors() {
  if (process.platform !== "linux") return [];
  try {
    const output = execFileSync("xrandr", ["--listmonitors"], {
      encoding: "utf8",
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseMonitors(output);
  } catch {
    return [];
  }
}

/**
 * The screen a test window should use: the widest monitor that is not the
 * primary one, falling back to the primary (or the first) when there is only
 * one screen. Chosen by area so a large secondary display wins over a small
 * mirrored panel.
 */
export function targetMonitor(list) {
  if (list.length === 0) return null;
  const area = (m) => m.width * m.height;
  const secondary = list.filter((m) => !m.primary).sort((a, b) => area(b) - area(a));
  return secondary[0] ?? [...list].sort((a, b) => area(b) - area(a))[0] ?? null;
}

function parsePair(raw, separator) {
  if (raw === undefined) return null;
  const parts = raw.split(separator).map((part) => Number(part.trim()));
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
}

/**
 * The `--window-position` / `--window-size` flags for a headed test window, or
 * `[]` when the screen cannot be determined (Chrome then does whatever it does
 * today, which is the honest fallback rather than a guess).
 */
export function windowArgs(list = monitors(), size = DEFAULT_WINDOW_SIZE) {
  const monitor = targetMonitor(list);
  if (monitor === null) return [];
  const wanted = parsePair(process.env.SUITE_E2E_WINDOW_SIZE, /[x,]/) ?? [size.width, size.height];
  const width = Math.min(Math.max(320, wanted[0]), Math.max(320, monitor.width - INSET * 2));
  const height = Math.min(Math.max(240, wanted[1]), Math.max(240, monitor.height - INSET * 2));
  const override = parsePair(process.env.SUITE_E2E_WINDOW_POSITION, /,/);
  const x = override?.[0] ?? monitor.x + Math.round((monitor.width - width) / 2);
  const y = override?.[1] ?? monitor.y + Math.round((monitor.height - height) / 2);
  return [
    `--window-position=${Math.round(x)},${Math.round(y)}`,
    `--window-size=${Math.round(width)},${Math.round(height)}`,
  ];
}
