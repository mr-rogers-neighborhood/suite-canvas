import { describe, expect, it } from "vitest";
import {
  CLAIM_OUTCOMES,
  MEMORY_SEGMENTS,
  MetricsCollector,
  type MetricsGauges,
  readProcessRss,
  STATUS_CLASSES,
  statusClassOf,
} from "./metrics.js";

/** Everything a label is allowed to be; ids, tokens and paths are not. */
const LABEL_VALUES = new Set<string>([
  ...STATUS_CLASSES,
  ...CLAIM_OUTCOMES,
  ...MEMORY_SEGMENTS,
  "1.4.0",
  "0.0.0-test",
]);

function labelValues(text: string): string[] {
  const values: string[] = [];
  for (const match of text.matchAll(/\{([^}]*)\}/gu)) {
    for (const pair of (match[1] ?? "").split(",")) {
      const [, value = ""] = pair.split("=");
      values.push(value.replace(/^"|"$/gu, ""));
    }
  }
  return values;
}

function sampleLines(text: string): string[] {
  return text.split("\n").filter((line) => line.length > 0 && !line.startsWith("#"));
}

describe("statusClassOf", () => {
  it("maps every code to exactly one class", () => {
    expect(statusClassOf(101)).toBe("1xx");
    expect(statusClassOf(200)).toBe("2xx");
    expect(statusClassOf(204)).toBe("2xx");
    expect(statusClassOf(301)).toBe("3xx");
    expect(statusClassOf(404)).toBe("4xx");
    expect(statusClassOf(429)).toBe("4xx");
    expect(statusClassOf(500)).toBe("5xx");
    expect(statusClassOf(Number.NaN)).toBe("1xx");
  });
});

describe("MetricsCollector", () => {
  const gauges: MetricsGauges = {
    rssBytes: () => 1024,
    uptimeSeconds: () => 12.5,
    databaseBytes: () => 2048,
    diskSoftBytes: () => 4096,
    openRooms: () => 2,
    projectionRooms: () => 1,
    documents: () => 7,
    documentWritesPending: () => 0,
    eventLoopLagMaxSeconds: () => 0.25,
    memorySplit: () => ({ heap: 512, external: 256, arrayBuffers: 128, rss: 1024 }),
  };

  it("increments every counter independently", () => {
    const collector = new MetricsCollector({ version: "1.4.0" });
    collector.observeHttp(200);
    collector.observeHttp(201);
    collector.observeHttp(404);
    collector.observeHttp(500);
    collector.observeHttp(429);
    collector.shareCreated();
    collector.publishAttempted();
    collector.publishConflict();
    collector.claimAttempted("claimed");
    collector.claimAttempted("conflict");
    collector.projectionRebuilt();
    collector.projectionFailed();

    const { counters } = collector.snapshot();
    expect(counters.httpRequests).toEqual({ "1xx": 0, "2xx": 2, "3xx": 0, "4xx": 2, "5xx": 1 });
    expect(counters.shareCreates).toBe(1);
    expect(counters.publishAttempts).toBe(1);
    expect(counters.publishConflicts).toBe(1);
    expect(counters.claimAttempts).toEqual({ claimed: 1, owned: 0, conflict: 1 });
    expect(counters.rateLimitRejections).toBe(1);
    expect(counters.projectionRebuilds).toBe(1);
    expect(counters.projectionFailures).toBe(1);
  });

  it("counts a 429 once as a class sample and once as a rejection", () => {
    const collector = new MetricsCollector();
    collector.observeHttp(429);
    collector.rateLimitRejected();

    const { counters } = collector.snapshot();
    expect(counters.httpRequests["4xx"]).toBe(1);
    expect(counters.rateLimitRejections).toBe(2);
  });

  it("resets counters without unwiring gauges", () => {
    const collector = new MetricsCollector({ gauges });
    collector.shareCreated(3);
    collector.reset();

    expect(collector.snapshot().counters.shareCreates).toBe(0);
    expect(collector.snapshot().gauges.databaseBytes).toBe(2048);
  });

  it("renders Prometheus text with the documented series", () => {
    const collector = new MetricsCollector({ version: "1.4.0", gauges });
    collector.observeHttp(200);

    const text = collector.prometheus();

    for (const name of [
      "suite_http_requests_total",
      "suite_share_creates_total",
      "suite_publish_attempts_total",
      "suite_publish_conflicts_total",
      "suite_claim_attempts_total",
      "suite_rate_limit_rejections_total",
      "suite_projection_rebuilds_total",
      "suite_projection_failures_total",
      "suite_projection_skips_total",
      "suite_projection_build_capped_total",
      "suite_peer_limit_rejections_total",
      "suite_document_limit_rejections_total",
      "suite_room_backpressure_total",
      "suite_document_writes_total",
      "suite_event_loop_lag_breaches_total",
      "suite_build_info",
      "suite_rss_bytes",
      "suite_uptime_seconds",
      "suite_database_bytes",
      "suite_disk_soft_bytes",
      "suite_disk_above_soft",
      "suite_open_rooms",
      "suite_projection_rooms",
      "suite_documents",
      "suite_document_writes_pending",
      "suite_event_loop_lag_max_seconds",
      "suite_memory_split",
    ]) {
      expect(text, name).toContain(`# TYPE ${name} `);
      expect(text, name).toContain(`# HELP ${name} `);
    }

    expect(text).toContain('suite_http_requests_total{class="2xx"} 1');
    expect(text).toContain('suite_claim_attempts_total{outcome="claimed"} 0');
    expect(text).toContain('suite_build_info{version="1.4.0"} 1');
    expect(text).toContain("suite_rss_bytes 1024");
    expect(text).toContain("suite_uptime_seconds 12.5");
    expect(text).toContain("suite_disk_above_soft 0");
    expect(text).toContain('suite_memory_split{segment="heap"} 512');
    expect(text).toContain('suite_memory_split{segment="external"} 256');
    expect(text).toContain('suite_memory_split{segment="arrayBuffers"} 128');
    expect(text).toContain('suite_memory_split{segment="rss"} 1024');
    expect(text.endsWith("\n")).toBe(true);

    const sample = /^[a-zA-Z_:][a-zA-Z0-9_:]*(\{[^}]*\})? -?\d+(?:\.\d+)?$/u;
    for (const line of sampleLines(text)) {
      expect(sample.test(line), line).toBe(true);
    }
  });

  it("flags a disk above the soft watermark", () => {
    const collector = new MetricsCollector({
      gauges: { databaseBytes: () => 8192, diskSoftBytes: () => 4096 },
    });

    expect(collector.snapshot().gauges.diskAboveSoft).toBe(1);
    expect(collector.prometheus()).toContain("suite_disk_above_soft 1");
  });

  it("omits a gauge it cannot read instead of reporting zero", () => {
    const collector = new MetricsCollector({
      version: "0.0.0-test",
      gauges: {
        databaseBytes: () => Number.POSITIVE_INFINITY,
        diskSoftBytes: () => {
          throw new Error("not wired");
        },
      },
    });

    const text = collector.prometheus();
    expect(text).not.toContain("suite_database_bytes");
    expect(text).not.toContain("suite_disk_soft_bytes");
    expect(text).not.toContain("suite_disk_above_soft");
    expect(text).not.toContain("suite_open_rooms");
  });

  it("never puts an id or a token in a label", () => {
    const workspaceId = "ws-4d5e6f7a8b9c";
    const shareToken = "sh_9f8e7d6c5b4a39281706f5e4d3c2b1a0";
    const collector = new MetricsCollector({ version: "1.4.0" });
    // The collector has no API that accepts an identifier: recording activity
    // that concerns a workspace must still leave the label set closed.
    collector.observeHttp(404);
    collector.shareCreated();
    collector.publishAttempted();
    collector.publishConflict();
    collector.claimAttempted("conflict");
    collector.rateLimitRejected();
    collector.projectionRebuilt();
    collector.projectionFailed();

    const text = collector.prometheus();
    expect(text).not.toContain(workspaceId);
    expect(text).not.toContain(shareToken);
    for (const value of labelValues(text)) {
      expect(LABEL_VALUES.has(value), value).toBe(true);
    }
  });

  it("exposes a JSON snapshot of counters and gauges", () => {
    const collector = new MetricsCollector({ version: "0.0.0-test", gauges });
    collector.shareCreated();

    const snapshot = JSON.parse(JSON.stringify(collector.snapshot())) as ReturnType<
      MetricsCollector["snapshot"]
    >;

    expect(snapshot.version).toBe("0.0.0-test");
    expect(snapshot.counters.shareCreates).toBe(1);
    expect(snapshot.gauges).toEqual({
      rssBytes: 1024,
      uptimeSeconds: 12.5,
      databaseBytes: 2048,
      diskSoftBytes: 4096,
      diskAboveSoft: 0,
      openRooms: 2,
      projectionRooms: 1,
      documents: 7,
      documentWritesPending: 0,
      eventLoopLagMaxSeconds: 0.25,
      memorySplit: { heap: 512, external: 256, arrayBuffers: 128, rss: 1024 },
    });
  });

  it("falls back to the process metrics for RSS and uptime", () => {
    const snapshot = new MetricsCollector().snapshot();
    expect(snapshot.gauges.rssBytes).toBeGreaterThan(0);
    expect(snapshot.gauges.uptimeSeconds).toBeGreaterThan(0);
  });

  it("reports a plausible resident set size for this process", () => {
    const snapshot = new MetricsCollector().snapshot();
    const rss = snapshot.gauges.rssBytes;

    expect(rss).not.toBeNull();
    // More than the code alone, nowhere near the 8 GiB a 32-bit-era bug showed.
    expect(rss ?? 0).toBeGreaterThan(10 * 1024 * 1024);
    expect(rss ?? 0).toBeLessThan(8 * 1024 * 1024 * 1024);
    expect(readProcessRss()).toBeGreaterThan(0);
    expect(sampleLines(new MetricsCollector().prometheus())).toContainEqual(
      expect.stringMatching(/^suite_rss_bytes \d+$/u),
    );
  });

  it("omits RSS instead of publishing a zero reading", () => {
    const collector = new MetricsCollector({ gauges: { rssBytes: () => 0 } });

    expect(collector.snapshot().gauges.rssBytes).toBeNull();
    expect(
      sampleLines(collector.prometheus()).some((line) => line.startsWith("suite_rss_bytes")),
    ).toBe(false);
  });

  it("splits this process's memory into the four segments", () => {
    const split = new MetricsCollector().snapshot().gauges.memorySplit;

    expect(split).not.toBeNull();
    const heap = split?.heap ?? null;
    const external = split?.external ?? null;
    const arrayBuffers = split?.arrayBuffers ?? null;
    const rss = split?.rss ?? null;
    for (const [segment, value] of Object.entries({ heap, external, arrayBuffers, rss })) {
      expect(value, segment).not.toBeNull();
      expect(value ?? -1, segment).toBeGreaterThanOrEqual(0);
    }
    // A real reading, not a placeholder: the heap holds a test runner's worth of
    // allocations, and the resident set holds the heap.
    expect(heap ?? 0).toBeGreaterThan(1024 * 1024);
    expect(rss ?? 0).toBeGreaterThan(heap ?? 0);
    expect(external ?? 0).toBeLessThanOrEqual(rss ?? 0);
    expect(arrayBuffers ?? 0).toBeLessThanOrEqual(external ?? 0);
  });

  it("publishes a zero segment but omits one that cannot be read", () => {
    const collector = new MetricsCollector({
      gauges: {
        memorySplit: () => ({ heap: Number.NaN, external: 10, arrayBuffers: 0, rss: 20 }),
      },
    });

    expect(collector.snapshot().gauges.memorySplit).toEqual({
      heap: null,
      external: 10,
      arrayBuffers: 0,
      rss: 20,
    });
    const lines = sampleLines(collector.prometheus());
    expect(lines).toContain('suite_memory_split{segment="external"} 10');
    expect(lines).toContain('suite_memory_split{segment="arrayBuffers"} 0');
    expect(lines.some((line) => line.includes('segment="heap"'))).toBe(false);
  });

  it("omits the whole memory split when the process cannot answer", () => {
    const collector = new MetricsCollector({
      gauges: {
        memorySplit: () => {
          throw new Error("no /proc");
        },
      },
    });

    expect(collector.snapshot().gauges.memorySplit).toBeNull();
    expect(
      sampleLines(collector.prometheus()).some((line) => line.startsWith("suite_memory_split")),
    ).toBe(false);
  });
});
