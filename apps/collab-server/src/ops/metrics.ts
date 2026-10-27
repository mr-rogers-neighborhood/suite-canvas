import { serverVersion } from "../config/config.js";

/**
 * Process metrics without a client library. Counters are incremented where the
 * server already knows the event; gauges are read at scrape time from the
 * component that owns the number.
 *
 * Labels are closed sets — a status class, a claim outcome, the build version.
 * A workspace id, share id or token must never become a label: it multiplies
 * the series and writes a capability into whatever scrapes the endpoint.
 */

/** HTTP status classes. A code maps to exactly one, so the set stays fixed. */
export const STATUS_CLASSES = ["1xx", "2xx", "3xx", "4xx", "5xx"] as const;
export type StatusClass = (typeof STATUS_CLASSES)[number];

/** Outcomes of a workspace claim, mirroring `ClaimResult`. */
/**
 * Outcomes of recording an organization for a workspace: the first verified
 * session claims it, a later one is the same organization, or it is another one
 * and is refused.
 */
export const CLAIM_OUTCOMES = ["claimed", "owned", "conflict"] as const;
export type ClaimOutcome = (typeof CLAIM_OUTCOMES)[number];

/**
 * The parts of a process's memory a scrape has to tell apart. A Loro document
 * is WASM linear memory, which Node reports under `external` and
 * `arrayBuffers`, never under `heap`: a process holding hundreds of megabytes of
 * documents can show a heap of a few tens. A closed set, so the family stays
 * four series however many rooms are open.
 */
export const MEMORY_SEGMENTS = ["heap", "external", "arrayBuffers", "rss"] as const;
export type MemorySegment = (typeof MEMORY_SEGMENTS)[number];

/**
 * Cheap readers for values that change continuously. A source may return
 * `null` when the number is genuinely unknown (for example a disk watermark of
 * "unlimited"), in which case the series is omitted instead of guessed.
 */
export interface MetricsGauges {
  /**
   * Resident set size in bytes; defaults to `readProcessRss()`. A zero is never
   * a real reading, so it is omitted rather than published.
   */
  rssBytes?: () => number | null;
  /** Seconds since the process started; defaults to `process.uptime()`. */
  uptimeSeconds?: () => number | null;
  /** Bytes the document database occupies. */
  databaseBytes?: () => number | null;
  /** `diskSoftBytes` in force, so a scraper can compare it with the disk gauge. */
  diskSoftBytes?: () => number | null;
  /** Rooms the sync server currently holds. */
  openRooms?: () => number | null;
  /** Share projection rooms the worker holds. */
  projectionRooms?: () => number | null;
  /** Stored documents (workspace rooms plus projections). */
  documents?: () => number | null;
  /** Writes accepted by the document store and not yet on disk. */
  documentWritesPending?: () => number | null;
  /** Longest event-loop lag sample seen, in seconds. */
  eventLoopLagMaxSeconds?: () => number | null;
  /**
   * Memory in bytes by segment; defaults to `readProcessMemory()`. `rss` repeats
   * `rssBytes` so one query answers what the resident set is made of.
   */
  memorySplit?: () => Record<MemorySegment, number> | null;
}

/**
 * A histogram rendered into Prometheus text. The relay keeps four of them —
 * event-loop lag, projection build time, document write time — so the shape is
 * generic and the collector only renders what a source reports.
 */
export interface HistogramSnapshot {
  /** Cumulative counts, one per bound plus the implicit `+Inf`. */
  counts: readonly number[];
  count: number;
  sum: number;
}

export interface HistogramSeries {
  /** Metric name, without the `_bucket`, `_sum` or `_count` suffix. */
  name: string;
  help: string;
  /** Upper bounds, ascending; the last bucket is `+Inf`. */
  bounds: readonly number[];
  read: () => HistogramSnapshot;
}

export interface MetricsSnapshot {
  version: string;
  counters: {
    httpRequests: Record<StatusClass, number>;
    shareCreates: number;
    publishAttempts: number;
    publishConflicts: number;
    claimAttempts: Record<ClaimOutcome, number>;
    rateLimitRejections: number;
    projectionRebuilds: number;
    projectionFailures: number;
    projectionSkips: number;
    projectionCapped: number;
    peerLimitRejections: number;
    documentLimitRejections: number;
    roomBackpressureRejections: number;
    documentWrites: number;
    eventLoopLagBreaches: number;
  };
  gauges: {
    rssBytes: number | null;
    uptimeSeconds: number | null;
    databaseBytes: number | null;
    diskSoftBytes: number | null;
    diskAboveSoft: number | null;
    openRooms: number | null;
    projectionRooms: number | null;
    documents: number | null;
    documentWritesPending: number | null;
    eventLoopLagMaxSeconds: number | null;
    /**
     * Memory by segment, or `null` when the process cannot report it. A segment
     * whose reading is not a finite number is `null` and its series is absent.
     */
    memorySplit: Record<MemorySegment, number | null> | null;
  };
}

export interface MetricsOptions {
  /** Stamped into `suite_build_info`; defaults to the configured server version. */
  version?: string;
  gauges?: MetricsGauges;
}

/** The class of an HTTP status code; anything unroutable counts as `1xx`. */
export function statusClassOf(status: number): StatusClass {
  if (!Number.isFinite(status) || status < 200) return "1xx";
  if (status < 300) return "2xx";
  if (status < 400) return "3xx";
  if (status < 500) return "4xx";
  return "5xx";
}

function zeroCounters(): MetricsSnapshot["counters"] {
  return {
    httpRequests: { "1xx": 0, "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 },
    shareCreates: 0,
    publishAttempts: 0,
    publishConflicts: 0,
    claimAttempts: { claimed: 0, owned: 0, conflict: 0 },
    rateLimitRejections: 0,
    projectionRebuilds: 0,
    projectionFailures: 0,
    projectionSkips: 0,
    projectionCapped: 0,
    peerLimitRejections: 0,
    documentLimitRejections: 0,
    roomBackpressureRejections: 0,
    documentWrites: 0,
    eventLoopLagBreaches: 0,
  };
}

/** Escapes one label value for the Prometheus text exposition format. */
function escapeLabel(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"').replace(/\n/gu, "\\n");
}

/** A finite number as text; `null` never reaches this function. */
function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function read(source: (() => number | null) | undefined, fallback: () => number | null) {
  let value: number | null;
  try {
    value = source?.() ?? fallback();
  } catch {
    // A gauge that cannot be read is omitted, never reported as zero.
    return null;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The resident set size of this process, in bytes, or `null` when the platform
 * cannot answer. One reader for both the scrape (`suite_rss_bytes`) and
 * `/api/admin/status`, so the two can never disagree.
 */
export function readProcessRss(): number | null {
  try {
    const { rss } = process.memoryUsage();
    return Number.isFinite(rss) && rss > 0 ? Math.floor(rss) : null;
  } catch {
    return null;
  }
}

/**
 * RSS is never legitimately zero: a process always maps at least its own code.
 * A zero therefore means "no reading", and publishing it would make an alert
 * that compares the gauge against a threshold silently pass. Such a reading is
 * dropped, so the series is absent and `deploy/alert.sh` reports it as skipped.
 */
function readRss(source: (() => number | null) | undefined): number | null {
  const value = read(source, readProcessRss);
  return value !== null && value > 0 ? value : null;
}

/**
 * One reading of `process.memoryUsage()`, split into the published segments.
 * Throws only if Node itself cannot answer, which `readMemorySplit` turns into
 * an absent family.
 */
function readProcessMemory(): Record<MemorySegment, number> {
  const usage = process.memoryUsage();
  return {
    heap: usage.heapUsed,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
    rss: usage.rss,
  };
}

/**
 * The split as published. A segment is omitted when its reading is not a finite
 * number. Zero is published here, unlike RSS: `external` and `arrayBuffers` are
 * genuinely zero in a process that holds no WASM memory, and reporting that is
 * the answer a reader wants.
 */
function readMemorySplit(
  source: (() => Record<MemorySegment, number> | null) | undefined,
): Record<MemorySegment, number | null> | null {
  let usage: Record<MemorySegment, number> | null;
  try {
    usage = source?.() ?? readProcessMemory();
  } catch {
    return null;
  }
  if (usage === null) return null;
  const split = {} as Record<MemorySegment, number | null>;
  let published = 0;
  for (const segment of MEMORY_SEGMENTS) {
    const value = usage[segment];
    const valid = typeof value === "number" && Number.isFinite(value) && value >= 0;
    split[segment] = valid ? Math.floor(value) : null;
    if (valid) published += 1;
  }
  return published > 0 ? split : null;
}

/** Every gauge that is one number; `memorySplit` is a family and is rendered separately. */
type ScalarGaugeKey = Exclude<keyof MetricsSnapshot["gauges"], "memorySplit">;

const GAUGE_HELP: Record<ScalarGaugeKey, string> = {
  rssBytes: "Resident set size of the server process in bytes.",
  uptimeSeconds: "Seconds since the server process started.",
  databaseBytes: "Bytes the document database occupies (page count x page size).",
  diskSoftBytes: "The disk soft watermark in force; unlimited when the series is absent.",
  diskAboveSoft: "1 when databaseBytes is above diskSoftBytes, 0 when it is not.",
  openRooms: "Rooms the sync server currently holds.",
  projectionRooms: "Share projection rooms the projection worker holds.",
  documents: "Stored documents: workspace snapshots plus share projections.",
  documentWritesPending: "Document writes accepted by the store and not yet on disk.",
  eventLoopLagMaxSeconds: "Longest event-loop lag sample seen since start, in seconds.",
};

const GAUGE_NAMES: Record<ScalarGaugeKey, string> = {
  rssBytes: "suite_rss_bytes",
  uptimeSeconds: "suite_uptime_seconds",
  databaseBytes: "suite_database_bytes",
  diskSoftBytes: "suite_disk_soft_bytes",
  diskAboveSoft: "suite_disk_above_soft",
  openRooms: "suite_open_rooms",
  projectionRooms: "suite_projection_rooms",
  documents: "suite_documents",
  documentWritesPending: "suite_document_writes_pending",
  eventLoopLagMaxSeconds: "suite_event_loop_lag_max_seconds",
};

const MEMORY_SPLIT_HELP =
  "Process memory in bytes by segment; Loro documents live in external/arrayBuffers, not heap.";

/** One counter/gauge collector for a whole process. */
export class MetricsCollector {
  private counters = zeroCounters();
  private gauges: MetricsGauges;
  private version: string;
  private histograms: HistogramSeries[] = [];

  constructor(options: MetricsOptions = {}) {
    this.gauges = { ...options.gauges };
    this.version = options.version ?? serverVersion();
  }

  /** Merges gauge readers; the last wiring of a name wins. */
  setGauges(gauges: MetricsGauges): void {
    this.gauges = { ...this.gauges, ...gauges };
  }

  /**
   * Registers histograms to render alongside the counters. Re-registering a name
   * replaces it, so boot wiring is idempotent and a test can reset a collector.
   */
  setHistograms(histograms: readonly HistogramSeries[]): void {
    const merged = new Map(this.histograms.map((series) => [series.name, series]));
    for (const series of histograms) merged.set(series.name, series);
    this.histograms = [...merged.values()];
  }

  /** Stamps `suite_build_info`; called once at boot with the resolved version. */
  setVersion(version: string): void {
    this.version = version;
  }

  /** Clears every counter; gauges stay wired. Used by tests between cases. */
  reset(): void {
    this.counters = zeroCounters();
  }

  /** One finished HTTP response. A 429 is also a rate-limit rejection. */
  observeHttp(status: number): void {
    this.counters.httpRequests[statusClassOf(status)] += 1;
    if (status === 429) this.counters.rateLimitRejections += 1;
  }

  shareCreated(count = 1): void {
    this.counters.shareCreates += count;
  }

  publishAttempted(count = 1): void {
    this.counters.publishAttempts += count;
  }

  publishConflict(count = 1): void {
    this.counters.publishConflicts += count;
  }

  claimAttempted(outcome: ClaimOutcome, count = 1): void {
    this.counters.claimAttempts[outcome] += count;
  }

  rateLimitRejected(count = 1): void {
    this.counters.rateLimitRejections += count;
  }

  projectionRebuilt(count = 1): void {
    this.counters.projectionRebuilds += count;
  }

  projectionFailed(count = 1): void {
    this.counters.projectionFailures += count;
  }

  /** Rebuilds skipped because the source had not changed since the last one. */
  projectionSkipped(count = 1): void {
    this.counters.projectionSkips += count;
  }

  /** A rebuild refused or abandoned because it exceeded the build-time cap. */
  projectionCapped(count = 1): void {
    this.counters.projectionCapped += count;
  }

  /** Joins refused because the room had reached `SUITE_MAX_PEERS_PER_ROOM`. */
  peerLimitRejected(count = 1): void {
    this.counters.peerLimitRejections += count;
  }

  /** Joins refused because the room's document is over its byte budget. */
  documentLimitRejected(count = 1): void {
    this.counters.documentLimitRejections += count;
  }

  /** Work refused because one room already had its outstanding bound in flight. */
  roomBackpressure(count = 1): void {
    this.counters.roomBackpressureRejections += count;
  }

  /** Document writes made durable by the store's writer. */
  documentWritten(count = 1): void {
    this.counters.documentWrites += count;
  }

  /** Event-loop samples at or above the threshold since start. */
  eventLoopLagBroke(count = 1): void {
    this.counters.eventLoopLagBreaches += count;
  }

  /** Counters as they stand, plus gauges read now. */
  snapshot(): MetricsSnapshot {
    const gauges = this.gauges;
    const rssBytes = readRss(gauges.rssBytes);
    const uptimeSeconds = read(gauges.uptimeSeconds, () => process.uptime());
    const databaseBytes = read(gauges.databaseBytes, () => null);
    const diskSoftBytes = read(gauges.diskSoftBytes, () => null);
    const diskAboveSoft =
      databaseBytes === null || diskSoftBytes === null
        ? null
        : databaseBytes > diskSoftBytes
          ? 1
          : 0;
    return {
      version: this.version,
      counters: {
        httpRequests: { ...this.counters.httpRequests },
        shareCreates: this.counters.shareCreates,
        publishAttempts: this.counters.publishAttempts,
        publishConflicts: this.counters.publishConflicts,
        claimAttempts: { ...this.counters.claimAttempts },
        rateLimitRejections: this.counters.rateLimitRejections,
        projectionRebuilds: this.counters.projectionRebuilds,
        projectionFailures: this.counters.projectionFailures,
        projectionSkips: this.counters.projectionSkips,
        projectionCapped: this.counters.projectionCapped,
        peerLimitRejections: this.counters.peerLimitRejections,
        documentLimitRejections: this.counters.documentLimitRejections,
        roomBackpressureRejections: this.counters.roomBackpressureRejections,
        documentWrites: this.counters.documentWrites,
        eventLoopLagBreaches: this.counters.eventLoopLagBreaches,
      },
      gauges: {
        rssBytes,
        uptimeSeconds,
        databaseBytes,
        diskSoftBytes,
        diskAboveSoft,
        openRooms: read(gauges.openRooms, () => null),
        projectionRooms: read(gauges.projectionRooms, () => null),
        documents: read(gauges.documents, () => null),
        documentWritesPending: read(gauges.documentWritesPending, () => null),
        eventLoopLagMaxSeconds: read(gauges.eventLoopLagMaxSeconds, () => null),
        memorySplit: readMemorySplit(gauges.memorySplit),
      },
    };
  }

  /**
   * Prometheus text exposition, version 0.0.4, without a client library. Every
   * series is `# HELP`-ed and `# TYPE`-ed so a scraper, a test or `awk` can read
   * it; unlimited or unknown gauges are absent rather than emitted as NaN.
   */
  prometheus(): string {
    const snapshot = this.snapshot();
    const { counters, gauges } = snapshot;
    const lines: string[] = [];

    const counter = (name: string, help: string, samples: readonly string[]): void => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`, ...samples);
    };
    const gauge = (name: string, help: string, value: number | null): void => {
      if (value === null) return;
      lines.push(
        `# HELP ${name} ${help}`,
        `# TYPE ${name} gauge`,
        `${name} ${formatNumber(value)}`,
      );
    };

    counter(
      "suite_http_requests_total",
      "HTTP responses by status class.",
      STATUS_CLASSES.map(
        (statusClass) =>
          `suite_http_requests_total{class="${statusClass}"} ${formatNumber(counters.httpRequests[statusClass])}`,
      ),
    );
    counter("suite_share_creates_total", "Share links created.", [
      `suite_share_creates_total ${formatNumber(counters.shareCreates)}`,
    ]);
    counter("suite_publish_attempts_total", "Publishes an editor attempted.", [
      `suite_publish_attempts_total ${formatNumber(counters.publishAttempts)}`,
    ]);
    counter("suite_publish_conflicts_total", "Publishes refused because the workspace moved on.", [
      `suite_publish_conflicts_total ${formatNumber(counters.publishConflicts)}`,
    ]);
    counter(
      "suite_claim_attempts_total",
      "Workspace claim attempts by outcome.",
      CLAIM_OUTCOMES.map(
        (outcome) =>
          `suite_claim_attempts_total{outcome="${outcome}"} ${formatNumber(counters.claimAttempts[outcome])}`,
      ),
    );
    counter("suite_rate_limit_rejections_total", "Requests refused with 429.", [
      `suite_rate_limit_rejections_total ${formatNumber(counters.rateLimitRejections)}`,
    ]);
    counter("suite_projection_rebuilds_total", "Projection rebuilds requested.", [
      `suite_projection_rebuilds_total ${formatNumber(counters.projectionRebuilds)}`,
    ]);
    counter("suite_projection_failures_total", "Projection rebuilds that failed.", [
      `suite_projection_failures_total ${formatNumber(counters.projectionFailures)}`,
    ]);
    counter(
      "suite_projection_skips_total",
      "Projection rebuilds skipped because the source had not changed.",
      [`suite_projection_skips_total ${formatNumber(counters.projectionSkips)}`],
    );
    counter(
      "suite_projection_build_capped_total",
      "Projection rebuilds refused or abandoned over the build-time cap.",
      [`suite_projection_build_capped_total ${formatNumber(counters.projectionCapped)}`],
    );
    counter("suite_peer_limit_rejections_total", "Joins refused by the per-room peer cap.", [
      `suite_peer_limit_rejections_total ${formatNumber(counters.peerLimitRejections)}`,
    ]);
    counter(
      "suite_document_limit_rejections_total",
      "Joins refused because the room's document is over its byte budget.",
      [`suite_document_limit_rejections_total ${formatNumber(counters.documentLimitRejections)}`],
    );
    counter(
      "suite_room_backpressure_total",
      "Room work refused because that room already had its bound in flight.",
      [`suite_room_backpressure_total ${formatNumber(counters.roomBackpressureRejections)}`],
    );
    counter("suite_document_writes_total", "Document writes made durable.", [
      `suite_document_writes_total ${formatNumber(counters.documentWrites)}`,
    ]);
    counter("suite_event_loop_lag_breaches_total", "Event-loop samples over the threshold.", [
      `suite_event_loop_lag_breaches_total ${formatNumber(counters.eventLoopLagBreaches)}`,
    ]);

    for (const series of this.histograms) {
      const snapshot = series.read();
      lines.push(`# HELP ${series.name} ${series.help}`, `# TYPE ${series.name} histogram`);
      let index = 0;
      for (const bound of series.bounds) {
        const value = snapshot.counts[index] ?? snapshot.count;
        lines.push(`${series.name}_bucket{le="${formatNumber(bound)}"} ${formatNumber(value)}`);
        index += 1;
      }
      lines.push(
        `${series.name}_bucket{le="+Inf"} ${formatNumber(snapshot.counts[series.bounds.length] ?? snapshot.count)}`,
        `${series.name}_sum ${formatNumber(snapshot.sum)}`,
        `${series.name}_count ${formatNumber(snapshot.count)}`,
      );
    }

    lines.push(
      "# HELP suite_build_info Build information; the value is always 1.",
      "# TYPE suite_build_info gauge",
      `suite_build_info{version="${escapeLabel(snapshot.version)}"} 1`,
    );

    for (const key of Object.keys(GAUGE_NAMES) as ScalarGaugeKey[]) {
      gauge(GAUGE_NAMES[key], GAUGE_HELP[key], gauges[key]);
    }

    if (gauges.memorySplit !== null) {
      const samples = MEMORY_SEGMENTS.flatMap((segment) => {
        const value = gauges.memorySplit?.[segment] ?? null;
        return value === null
          ? []
          : [`suite_memory_split{segment="${segment}"} ${formatNumber(value)}`];
      });
      if (samples.length > 0) {
        lines.push(
          `# HELP suite_memory_split ${MEMORY_SPLIT_HELP}`,
          "# TYPE suite_memory_split gauge",
          ...samples,
        );
      }
    }

    return `${lines.join("\n")}\n`;
  }
}

/**
 * The process-wide collector. `server.ts` wires the gauges and increments the
 * counters; the admin endpoint renders this instance, so a test can reset it.
 */
export const metrics = new MetricsCollector();
