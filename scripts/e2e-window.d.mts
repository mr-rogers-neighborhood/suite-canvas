/** Types for the headed-window placement helper the ICE specs import. */

export interface MonitorRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly primary: boolean;
}

export const DEFAULT_WINDOW_SIZE: { readonly width: number; readonly height: number };

export function parseMonitors(output: string): MonitorRect[];
export function monitors(): MonitorRect[];
export function targetMonitor(list: readonly MonitorRect[]): MonitorRect | null;
export function windowArgs(
  list?: readonly MonitorRect[],
  size?: { readonly width: number; readonly height: number },
): string[];
