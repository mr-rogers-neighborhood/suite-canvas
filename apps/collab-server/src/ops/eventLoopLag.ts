import type { Logger } from "../logging.js";

/**
 * How late the event loop is, as a distribution rather than a duration.
 *
 * The relay is one Node process that does everything on one thread: socket
 * frames, presence, projection rebuilds and (before `persistenceWriter.ts`) the
 * document write. None of that work can be timed usefully on its own — a save
 * that takes 40 ms is fine when the loop is idle and a disaster when three of
 * them queue behind a rebuild. So the health signal is not "how long did the
 * save take" but "how late was the loop", sampled on a fixed cadence:
 *
 * - every `intervalMs` the monitor expects to wake up; the difference between
 *   the expected and the actual wake-up is one sample of lag, in seconds;
 * - the samples feed a Prometheus histogram (`suite_event_loop_lag_seconds`),
 *   so a scrape can answer "how much of the last five minutes was late";
 * - a sample at or above `thresholdMs` is a breach. A *sustained* breach is
 *   `sustainedSamples` breaches in a row, which is what logs one line: a single
 *   late sample is a garbage collection, a run of them is a server that has
 *   stopped answering.
 *
 * The cadence bounds how *short* a stall can be detected: blocking the loop for
 * 30 ms is measured exactly, but it is only attributed to the window it lands
 * in. Sampling every 50 ms keeps that error well under a frame and costs one
 * timer wake-up per 50 ms.
 */

/** Sampling cadence: one timer wake-up per 50 ms, unref'd. */
export const DEFAULT_LAG_INTERVAL_MS = 50;

/** A sample at or above this is a breach. `SUITE_EVENT_LOOP_LAG_MS` overrides it. */
export const DEFAULT_LAG_THRESHOLD_MS = 100;

/** Consecutive breaching samples that make a breach "sustained". */
export const DEFAULT_SUSTAINED_BREACHES = 5;

/** Histogram bounds in seconds: 5 ms to 10 s, which spans a frame to a stall. */
export const LAG_BUCKETS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export interface EventLoopLagOptions {
  intervalMs?: number;
  thresholdMs?: number;
  sustainedSamples?: number;
  logger?: Pick<Logger, "warn">;
  /** Monotonic clock in milliseconds; `performance.now` unless a test replaces it. */
  now?: () => number;
  /** Timer, injected so a test can drive the samples it wants to assert on. */
  startTimer?: (tick: () => void, intervalMs: number) => { cancel: () => void };
  /** Called for every sample at or above the threshold, for the counter. */
  onBreach?: (lagMs: number) => void;
  /**
   * Extra fields for the sustained-breach line. The server puts the document
   * write counters here, so the one line an operator sees says whether the
   * writes are what the loop was late for.
   */
  context?: () => Record<string, unknown>;
}

export interface EventLoopLagSnapshot {
  /** Samples taken since start. */
  samples: number;
  /** Longest single sample, in milliseconds. */
  maxMs: number;
  /** Samples at or above the threshold. */
  breaches: number;
  /** Longest run of consecutive breaching samples. */
  longestBreachRun: number;
  /** Whether the last sample breached. */
  breaching: boolean;
  /** The threshold in force, in milliseconds. */
  thresholdMs: number;
}

/** One histogram sample set: cumulative counts, total and sum, in seconds. */
export interface LagHistogramSnapshot {
  counts: readonly number[];
  count: number;
  sum: number;
}

/**
 * Small fixed-bucket histogram. Cumulative counts are computed on read so the
 * `observe` path stays one increment per sample.
 */
export class LagHistogram {
  private readonly bounds: readonly number[];
  private readonly perBucket: number[];
  private total = 0;
  private totalSum = 0;

  constructor(bounds: readonly number[] = LAG_BUCKETS_SECONDS) {
    this.bounds = bounds;
    this.perBucket = new Array<number>(bounds.length + 1).fill(0);
  }

  observe(seconds: number): void {
    const value = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    this.total += 1;
    this.totalSum += value;
    const index = this.bounds.findIndex((bound) => value <= bound);
    const bucket = index === -1 ? this.bounds.length : index;
    this.perBucket[bucket] = (this.perBucket[bucket] ?? 0) + 1;
  }

  /** Cumulative counts, as Prometheus expects: bucket `i` includes `0..i`. */
  snapshot(): LagHistogramSnapshot {
    const counts: number[] = [];
    let running = 0;
    for (const count of this.perBucket) {
      running += count;
      counts.push(running);
    }
    return { counts, count: this.total, sum: this.totalSum };
  }

  /** Bounds in seconds, in ascending order. */
  get boundsSeconds(): readonly number[] {
    return this.bounds;
  }

  reset(): void {
    this.perBucket.fill(0);
    this.total = 0;
    this.totalSum = 0;
  }
}

const defaultTimer = (tick: () => void, intervalMs: number): { cancel: () => void } => {
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return { cancel: () => clearInterval(timer) };
};

/** Measures event-loop lag and reports a sustained breach once per episode. */
export class EventLoopLagMonitor {
  readonly histogram = new LagHistogram();
  readonly intervalMs: number;
  readonly thresholdMs: number;
  readonly sustainedSamples: number;

  private readonly options: EventLoopLagOptions;
  private readonly clock: () => number;
  private timer: { cancel: () => void } | null = null;
  private expected = 0;
  private samples = 0;
  private maxMs = 0;
  private breaches = 0;
  private run = 0;
  private longestRun = 0;
  private breaching = false;
  /** True while a sustained breach has been logged and not yet recovered. */
  private reported = false;

  constructor(options: EventLoopLagOptions = {}) {
    this.options = options;
    this.intervalMs = options.intervalMs ?? DEFAULT_LAG_INTERVAL_MS;
    this.thresholdMs = options.thresholdMs ?? DEFAULT_LAG_THRESHOLD_MS;
    this.sustainedSamples = Math.max(1, options.sustainedSamples ?? DEFAULT_SUSTAINED_BREACHES);
    this.clock = options.now ?? (() => performance.now());
  }

  start(): void {
    if (this.timer !== null) return;
    this.expected = this.clock() + this.intervalMs;
    const startTimer = this.options.startTimer ?? defaultTimer;
    this.timer = startTimer(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    this.timer?.cancel();
    this.timer = null;
  }

  /** One expected wake-up: the delay past `intervalMs` is the lag. */
  private tick(): void {
    const now = this.clock();
    const lag = Math.max(0, now - this.expected);
    // Scheduled from *now*, not from the expected time: a stalled loop must not
    // make the next sample report the same stall again.
    this.expected = now + this.intervalMs;
    this.observe(lag);
  }

  /** Records one sample, in milliseconds. Public so a test can feed a stall. */
  observe(lagMs: number): void {
    this.samples += 1;
    this.maxMs = Math.max(this.maxMs, lagMs);
    this.histogram.observe(lagMs / 1000);
    this.breaching = lagMs >= this.thresholdMs;
    if (!this.breaching) {
      this.run = 0;
      this.reported = false;
      return;
    }
    this.breaches += 1;
    this.options.onBreach?.(lagMs);
    this.run += 1;
    this.longestRun = Math.max(this.longestRun, this.run);
    if (this.run < this.sustainedSamples || this.reported) return;
    this.reported = true;
    this.options.logger?.warn("event loop lag sustained above its threshold", {
      code: "event-loop-lag",
      lagMs: Math.round(lagMs),
      thresholdMs: this.thresholdMs,
      consecutive: this.run,
      sustainedSamples: this.sustainedSamples,
      windowMs: this.intervalMs * this.run,
      ...this.options.context?.(),
    });
  }

  /** Whether a sustained breach is open; the counter is read by the scraper. */
  isBreaching(): boolean {
    return this.breaching;
  }

  snapshot(): EventLoopLagSnapshot {
    return {
      samples: this.samples,
      maxMs: this.maxMs,
      breaches: this.breaches,
      longestBreachRun: this.longestRun,
      breaching: this.breaching,
      thresholdMs: this.thresholdMs,
    };
  }

  /** Longest sample seen, in seconds, for the `_max` gauge. */
  maxSeconds(): number {
    return this.maxMs / 1000;
  }
}

/**
 * The threshold from `SUITE_EVENT_LOOP_LAG_MS`. Only a positive number is a
 * threshold: a missing, zero or unreadable value falls back to the default
 * rather than switching the breach detection off.
 */
export function eventLoopLagThreshold(
  env: { SUITE_EVENT_LOOP_LAG_MS?: string | undefined } = process.env,
): number {
  const raw = env.SUITE_EVENT_LOOP_LAG_MS?.trim();
  if (!raw) return DEFAULT_LAG_THRESHOLD_MS;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_LAG_THRESHOLD_MS;
}
