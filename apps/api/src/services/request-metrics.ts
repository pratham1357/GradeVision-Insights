/**
 * Process-local request counters for the instructor system-metrics endpoint.
 *
 * Deliberately tiny and in-memory: it tracks how many requests are in flight,
 * how many have been handled since boot, and a bounded window of recent
 * server-side processing durations (request received -> response finished).
 * No per-request identifiers, URLs, bodies, or user data are retained.
 */
const MAX_SAMPLES = 100;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface RequestMetricsSnapshot {
  inFlight: number;
  total: number;
  lastResponseTimeMs: number | null;
  averageResponseTimeMs: number | null;
  sampleSize: number;
}

class RequestMetrics {
  #inFlight = 0;
  #total = 0;
  #durations: number[] = [];

  /** A request entered the pipeline. */
  onRequestStart(): void {
    this.#inFlight += 1;
    this.#total += 1;
  }

  /** A request finished (or the connection closed). `durationMs` is server-side. */
  onRequestEnd(durationMs: number): void {
    this.#inFlight = Math.max(0, this.#inFlight - 1);
    if (Number.isFinite(durationMs) && durationMs >= 0) {
      this.#durations.push(durationMs);
      if (this.#durations.length > MAX_SAMPLES) this.#durations.shift();
    }
  }

  snapshot(): RequestMetricsSnapshot {
    const n = this.#durations.length;
    const last = n > 0 ? this.#durations[n - 1]! : null;
    const average = n > 0 ? this.#durations.reduce((sum, d) => sum + d, 0) / n : null;
    return {
      inFlight: this.#inFlight,
      total: this.#total,
      lastResponseTimeMs: last === null ? null : round(last),
      averageResponseTimeMs: average === null ? null : round(average),
      sampleSize: n,
    };
  }

  /** Test hook only. */
  reset(): void {
    this.#inFlight = 0;
    this.#total = 0;
    this.#durations = [];
  }
}

export const requestMetrics = new RequestMetrics();
