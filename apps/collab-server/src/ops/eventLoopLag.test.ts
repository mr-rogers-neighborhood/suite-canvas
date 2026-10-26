import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAG_THRESHOLD_MS,
  EventLoopLagMonitor,
  eventLoopLagThreshold,
  LAG_BUCKETS_SECONDS,
  LagHistogram,
} from "./eventLoopLag.js";

describe("LagHistogram", () => {
  it("counts cumulatively, so a bucket includes every faster sample", () => {
    const histogram = new LagHistogram([0.01, 0.1, 1]);
    histogram.observe(0.001);
    histogram.observe(0.05);
    histogram.observe(0.5);
    histogram.observe(30);

    const snapshot = histogram.snapshot();
    expect(snapshot.counts).toEqual([1, 2, 3, 4]);
    expect(snapshot.count).toBe(4);
    expect(snapshot.sum).toBeCloseTo(30.551, 3);
  });

  it("treats a negative or unreadable sample as zero rather than dropping it", () => {
    const histogram = new LagHistogram();
    histogram.observe(-1);
    histogram.observe(Number.NaN);

    const snapshot = histogram.snapshot();
    expect(snapshot.count).toBe(2);
    expect(snapshot.counts[0]).toBe(2);
  });

  it("starts at zero samples without pretending a reading", () => {
    const snapshot = new LagHistogram().snapshot();
    expect(snapshot.count).toBe(0);
    expect(snapshot.sum).toBe(0);
    expect(snapshot.counts).toHaveLength(LAG_BUCKETS_SECONDS.length + 1);
  });
});

describe("EventLoopLagMonitor", () => {
  it("records a sample per expected wake-up and measures the delay", () => {
    let clock = 0;
    const monitor = new EventLoopLagMonitor({ intervalMs: 50, now: () => clock });
    monitor.start();
    // Three wake-ups, one of which was 120 ms late.
    clock = 50;
    monitor.observe(0);
    clock = 100;
    monitor.observe(120);
    clock = 150;
    monitor.observe(0);
    monitor.stop();

    const snapshot = monitor.snapshot();
    expect(snapshot.samples).toBe(3);
    expect(snapshot.maxMs).toBe(120);
    expect(snapshot.breaches).toBe(1);
    expect(monitor.maxSeconds()).toBeCloseTo(0.12, 3);
  });

  it("logs one line per sustained breach, not one per sample", () => {
    const lines: string[] = [];
    const monitor = new EventLoopLagMonitor({
      thresholdMs: 100,
      sustainedSamples: 3,
      logger: { warn: (message, fields) => lines.push(`${message} ${JSON.stringify(fields)}`) },
    });

    monitor.observe(150);
    monitor.observe(150);
    // Below the run length: a spike, not a stall.
    expect(lines).toHaveLength(0);
    monitor.observe(150);
    expect(lines).toHaveLength(1);
    // Still breaching, but the episode is already reported.
    monitor.observe(200);
    monitor.observe(200);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("event-loop-lag");
    expect(lines[0]).toContain('"thresholdMs":100');
  });

  it("opens a new episode once the loop recovers", () => {
    const lines: string[] = [];
    const monitor = new EventLoopLagMonitor({
      thresholdMs: 100,
      sustainedSamples: 2,
      logger: { warn: (message) => lines.push(message) },
    });

    monitor.observe(120);
    monitor.observe(120);
    monitor.observe(1);
    expect(monitor.isBreaching()).toBe(false);
    monitor.observe(120);
    monitor.observe(120);
    expect(lines).toHaveLength(2);
    expect(monitor.snapshot().longestBreachRun).toBe(2);
  });

  it("runs on an unref'd timer and stops cleanly", () => {
    const monitor = new EventLoopLagMonitor({ intervalMs: 10 });
    monitor.start();
    monitor.start();
    monitor.stop();
    monitor.stop();
    expect(monitor.snapshot().samples).toBe(0);
  });
});

describe("eventLoopLagThreshold", () => {
  it("reads a positive millisecond threshold and falls back otherwise", () => {
    expect(eventLoopLagThreshold({})).toBe(DEFAULT_LAG_THRESHOLD_MS);
    expect(eventLoopLagThreshold({ SUITE_EVENT_LOOP_LAG_MS: "250" })).toBe(250);
    expect(eventLoopLagThreshold({ SUITE_EVENT_LOOP_LAG_MS: "0" })).toBe(DEFAULT_LAG_THRESHOLD_MS);
    expect(eventLoopLagThreshold({ SUITE_EVENT_LOOP_LAG_MS: "later" })).toBe(
      DEFAULT_LAG_THRESHOLD_MS,
    );
  });
});
