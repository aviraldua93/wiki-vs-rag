/**
 * Latency tracker — records and computes percentile latency statistics.
 *
 * Tracks per-query latency for both wiki and RAG systems,
 * computing p50, p95, and p99 percentiles.
 */

import { createLogger } from '../../logger.ts';

const log = createLogger('latency-tracker');

// ── Types ────────────────────────────────────────────────────────

/** A single latency measurement. */
export interface LatencyEntry {
  /** Which system produced this latency */
  system: 'wiki' | 'rag';
  /** Query ID */
  queryId: string;
  /** Response time in milliseconds */
  latencyMs: number;
  /** Timestamp */
  timestamp: string;
}

/** Percentile latency statistics. */
export interface LatencyStats {
  /** Number of measurements */
  count: number;
  /** Minimum latency */
  minMs: number;
  /** Maximum latency */
  maxMs: number;
  /** Mean latency */
  meanMs: number;
  /** Median (p50) latency */
  p50Ms: number;
  /** 95th percentile latency */
  p95Ms: number;
  /** 99th percentile latency */
  p99Ms: number;
}

// ── LatencyTracker ───────────────────────────────────────────────

/**
 * Tracks and computes latency statistics across benchmark runs.
 *
 * Supports:
 * - Per-query latency recording for both systems
 * - p50/p95/p99 percentile computation
 * - Per-system breakdowns
 */
export class LatencyTracker {
  private entries: LatencyEntry[] = [];

  /**
   * Record a latency measurement.
   */
  record(system: 'wiki' | 'rag', queryId: string, latencyMs: number): LatencyEntry {
    const entry: LatencyEntry = {
      system,
      queryId,
      latencyMs,
      timestamp: new Date().toISOString(),
    };
    this.entries.push(entry);
    log.debug({ system, queryId, latencyMs }, 'Latency recorded');
    return entry;
  }

  /**
   * Compute percentile from a sorted array of numbers.
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0];
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  /**
   * Compute latency statistics for a specific system.
   */
  getStats(system: 'wiki' | 'rag'): LatencyStats {
    const latencies = this.entries
      .filter((e) => e.system === system)
      .map((e) => e.latencyMs)
      .sort((a, b) => a - b);

    if (latencies.length === 0) {
      return { count: 0, minMs: 0, maxMs: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0 };
    }

    const sum = latencies.reduce((a, b) => a + b, 0);

    return {
      count: latencies.length,
      minMs: latencies[0],
      maxMs: latencies[latencies.length - 1],
      meanMs: sum / latencies.length,
      p50Ms: this.percentile(latencies, 50),
      p95Ms: this.percentile(latencies, 95),
      p99Ms: this.percentile(latencies, 99),
    };
  }

  /**
   * Get all recorded entries.
   */
  getEntries(): LatencyEntry[] {
    return [...this.entries];
  }

  /**
   * Reset all tracked entries.
   */
  reset(): void {
    this.entries = [];
  }

  /**
   * Export latency data as a plain object for JSON serialization.
   */
  toJSON(): { entries: LatencyEntry[]; wikiStats: LatencyStats; ragStats: LatencyStats } {
    return {
      entries: this.entries,
      wikiStats: this.getStats('wiki'),
      ragStats: this.getStats('rag'),
    };
  }
}

/**
 * Create a new LatencyTracker instance.
 */
export function createLatencyTracker(): LatencyTracker {
  return new LatencyTracker();
}
