import { serverVersion } from "./config.js";

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
export const CLAIM_OUTCOMES = ["owner", "mismatch"] as const;
export type ClaimOutcome = (typeof CLAIM_OUTCOMES)[number];

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
    claimAttempts: { owner: 0, mismatch: 0 },
    rateLimitRejections: 0,
    projectionRebuilds: 0,
    projectionFailures: 0,
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

const GAUGE_HELP: Record<keyof MetricsSnapshot["gauges"], string> = {
  rssBytes: "Resident set size of the server process in bytes.",
  uptimeSeconds: "Seconds since the server process started.",
  databaseBytes: "Bytes the document database occupies (page count x page size).",
  diskSoftBytes: "The disk soft watermark in force; unlimited when the series is absent.",
  diskAboveSoft: "1 when databaseBytes is above diskSoftBytes, 0 when it is not.",
  openRooms: "Rooms the sync server currently holds.",
  projectionRooms: "Share projection rooms the projection worker holds.",
  documents: "Stored documents: workspace snapshots plus share projections.",
};

const GAUGE_NAMES: Record<keyof MetricsSnapshot["gauges"], string> = {
  rssBytes: "suite_rss_bytes",
  uptimeSeconds: "suite_uptime_seconds",
  databaseBytes: "suite_database_bytes",
  diskSoftBytes: "suite_disk_soft_bytes",
  diskAboveSoft: "suite_disk_above_soft",
  openRooms: "suite_open_rooms",
  projectionRooms: "suite_projection_rooms",
  documents: "suite_documents",
};

/** One counter/gauge collector for a whole process. */
export class MetricsCollector {
  private counters = zeroCounters();
  private gauges: MetricsGauges;
  private version: string;

  constructor(options: MetricsOptions = {}) {
    this.gauges = { ...options.gauges };
    this.version = options.version ?? serverVersion();
  }

  /** Merges gauge readers; the last wiring of a name wins. */
  setGauges(gauges: MetricsGauges): void {
    this.gauges = { ...this.gauges, ...gauges };
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

    lines.push(
      "# HELP suite_build_info Build information; the value is always 1.",
      "# TYPE suite_build_info gauge",
      `suite_build_info{version="${escapeLabel(snapshot.version)}"} 1`,
    );

    for (const key of Object.keys(GAUGE_NAMES) as (keyof MetricsSnapshot["gauges"])[]) {
      gauge(GAUGE_NAMES[key], GAUGE_HELP[key], gauges[key]);
    }

    return `${lines.join("\n")}\n`;
  }
}

/**
 * The process-wide collector. `server.ts` wires the gauges and increments the
 * counters; the admin endpoint renders this instance, so a test can reset it.
 */
export const metrics = new MetricsCollector();
