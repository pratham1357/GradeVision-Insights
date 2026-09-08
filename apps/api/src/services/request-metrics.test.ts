/**
 * Unit test for the in-memory request counters behind the system-metrics
 * endpoint. No database, no HTTP.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { requestMetrics } from "./request-metrics.js";

beforeEach(() => {
  requestMetrics.reset();
});

describe("requestMetrics", () => {
  it("starts empty", () => {
    const snap = requestMetrics.snapshot();
    expect(snap).toMatchObject({
      inFlight: 0,
      total: 0,
      lastResponseTimeMs: null,
      averageResponseTimeMs: null,
      sampleSize: 0,
    });
  });

  it("increments in-flight and total on start, decrements only in-flight on end", () => {
    requestMetrics.onRequestStart();
    requestMetrics.onRequestStart();
    requestMetrics.onRequestStart();
    expect(requestMetrics.snapshot()).toMatchObject({ inFlight: 3, total: 3 });

    requestMetrics.onRequestEnd(10);
    requestMetrics.onRequestEnd(20);
    const snap = requestMetrics.snapshot();
    expect(snap.inFlight).toBe(1);
    expect(snap.total).toBe(3); // total never decrements
  });

  it("never lets in-flight go negative", () => {
    requestMetrics.onRequestEnd(5);
    requestMetrics.onRequestEnd(5);
    expect(requestMetrics.snapshot().inFlight).toBe(0);
  });

  it("reports last and rolling-average response times", () => {
    requestMetrics.onRequestStart();
    requestMetrics.onRequestEnd(10);
    requestMetrics.onRequestStart();
    requestMetrics.onRequestEnd(30);
    const snap = requestMetrics.snapshot();
    expect(snap.lastResponseTimeMs).toBe(30);
    expect(snap.averageResponseTimeMs).toBe(20);
    expect(snap.sampleSize).toBe(2);
  });

  it("ignores non-finite / negative durations", () => {
    requestMetrics.onRequestStart();
    requestMetrics.onRequestEnd(Number.NaN);
    requestMetrics.onRequestStart();
    requestMetrics.onRequestEnd(-4);
    expect(requestMetrics.snapshot().sampleSize).toBe(0);
    expect(requestMetrics.snapshot().inFlight).toBe(0);
  });

  it("bounds the duration window", () => {
    for (let i = 0; i < 250; i += 1) {
      requestMetrics.onRequestStart();
      requestMetrics.onRequestEnd(i);
    }
    expect(requestMetrics.snapshot().sampleSize).toBeLessThanOrEqual(100);
    // Most recent sample is retained.
    expect(requestMetrics.snapshot().lastResponseTimeMs).toBe(249);
  });
});
