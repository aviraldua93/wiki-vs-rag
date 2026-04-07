/**
 * Cost and latency tracking for benchmark evaluation.
 *
 * Records token usage, computes $/query for each system,
 * amortizes compilation costs, and tracks p50/p95/p99 latencies.
 */

import type { TokenUsage } from '../../types.ts';
import { createLogger } from '../../logger.ts';

const log = createLogger('cost-latency-tracker');

// ── Types ────────────────────────────────────────────────────────

/** Pricing per 1M tokens for different models. */
export interface ModelPricing {
  /** Cost per 1M input tokens in USD */
  inputPer1M: number;
  /** Cost per 1M output tokens in USD */
  outputPer1M: number;
}

/** A single cost record entry. */
export interface CostEntry {
  system: 'wiki' | 'rag';
  type: string;
  model: string;
  tokenUsage: TokenUsage;
  costUsd: number;
  queryId?: string;
  timestamp: string;
}

/** Accumulated cost data for a system. */
export interface CostRecord {
  /** System identifier */
  system: 'wiki' | 'rag';
  /** Total prompt tokens consumed */
  totalPromptTokens: number;
  /** Total completion tokens consumed */
  totalCompletionTokens: number;
  /** Total cost in USD */
  totalCostUsd: number;
  /** Number of queries tracked */
  queryCount: number;
  /** Average cost per query in USD */
  avgCostPerQuery: number;
  /** One-time build/compilation cost (amortized over queries) */
  buildCostUsd: number;
  /** Effective cost per query including amortized build cost */
  effectiveCostPerQuery: number;
}

/** A single latency record entry. */
export interface LatencyEntry {
  system: 'wiki' | 'rag';
  queryId: string;
  latencyMs: number;
  timestamp: string;
}

/** Latency statistics for a system. */
export interface LatencyStats {
  /** System identifier */
  system: 'wiki' | 'rag';
  /** Number of latency samples */
  count: number;
  /** Minimum latency in ms */
  min: number;
  /** Maximum latency in ms */
  max: number;
  /** Mean latency in ms */
  mean: number;
  /** Median (p50) latency in ms */
  p50: number;
  /** 95th percentile latency in ms */
  p95: number;
  /** 99th percentile latency in ms */
  p99: number;
}

// ── Default Pricing ──────────────────────────────────────────────

/** Default pricing for common OpenAI models (USD per 1M tokens). */
export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': { inputPer1M: 2.50, outputPer1M: 10.00 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.60 },
  'mock-gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.60 },
  'mock-gpt-4o': { inputPer1M: 2.50, outputPer1M: 10.00 },
};

// ── Cost Tracker ─────────────────────────────────────────────────

/**
 * Tracks token usage and costs across multiple queries.
 */
export class CostTracker {
  private entries: CostEntry[] = [];
  private buildCosts: Map<string, number> = new Map();
  private pricing: Record<string, ModelPricing>;

  constructor(pricing?: Record<string, ModelPricing>) {
    this.pricing = pricing ?? DEFAULT_PRICING;
  }

  /**
   * Calculate cost for a given token usage and model.
   */
  calculateCost(usage: TokenUsage, model: string): number {
    const pricing = this.pricing[model];
    if (!pricing) {
      log.warn({ model }, 'No pricing data for model, using gpt-4o-mini defaults');
      const fallback = this.pricing['gpt-4o-mini'] ?? { inputPer1M: 0.15, outputPer1M: 0.60 };
      return (usage.promptTokens * fallback.inputPer1M + usage.completionTokens * fallback.outputPer1M) / 1_000_000;
    }
    return (usage.promptTokens * pricing.inputPer1M + usage.completionTokens * pricing.outputPer1M) / 1_000_000;
  }

  /**
   * Record token usage for a query.
   * Supports both (system, usage, model) and (system, type, model, usage, queryId) signatures.
   */
  record(system: 'wiki' | 'rag', typeOrUsage: string | TokenUsage, modelOrModel?: string, usage?: TokenUsage, queryId?: string): void {
    let actualType: string;
    let actualModel: string;
    let actualUsage: TokenUsage;
    let actualQueryId: string | undefined;

    if (typeof typeOrUsage === 'string') {
      // Full signature: record(system, type, model, usage, queryId)
      actualType = typeOrUsage;
      actualModel = modelOrModel ?? 'gpt-4o-mini';
      actualUsage = usage!;
      actualQueryId = queryId;
    } else {
      // Short signature: record(system, usage, model)
      actualType = 'query';
      actualUsage = typeOrUsage;
      actualModel = modelOrModel ?? 'gpt-4o-mini';
      actualQueryId = undefined;
    }

    const cost = this.calculateCost(actualUsage, actualModel);
    this.entries.push({
      system,
      type: actualType,
      model: actualModel,
      tokenUsage: actualUsage,
      costUsd: cost,
      queryId: actualQueryId,
      timestamp: new Date().toISOString(),
    });

    log.debug({ system, type: actualType, cost }, 'Cost recorded');
  }

  /**
   * Record token usage for a query (convenience alias).
   */
  recordQuery(system: 'wiki' | 'rag', usage: TokenUsage, model: string = 'gpt-4o-mini'): void {
    this.record(system, usage, model);
  }

  /**
   * Record a one-time build/compilation cost for a system.
   */
  recordBuildCost(system: 'wiki' | 'rag', usage: TokenUsage, model: string = 'gpt-4o-mini'): void {
    const cost = this.calculateCost(usage, model);
    this.buildCosts.set(system, (this.buildCosts.get(system) ?? 0) + cost);
    log.info({ system, buildCost: cost }, 'Build cost recorded');
  }

  /**
   * Get cost summary for a system.
   */
  getCostRecord(system: 'wiki' | 'rag'): CostRecord {
    const systemEntries = this.entries.filter((e) => e.system === system);
    const totalPromptTokens = systemEntries.reduce((s, e) => s + e.tokenUsage.promptTokens, 0);
    const totalCompletionTokens = systemEntries.reduce((s, e) => s + e.tokenUsage.completionTokens, 0);
    const totalCostUsd = systemEntries.reduce((s, e) => s + e.costUsd, 0);
    const queryCount = systemEntries.length;
    const buildCostUsd = this.buildCosts.get(system) ?? 0;

    const avgCostPerQuery = queryCount > 0 ? totalCostUsd / queryCount : 0;
    const effectiveCostPerQuery = queryCount > 0
      ? avgCostPerQuery + (buildCostUsd / queryCount)
      : 0;

    return {
      system,
      totalPromptTokens,
      totalCompletionTokens,
      totalCostUsd,
      queryCount,
      avgCostPerQuery,
      buildCostUsd,
      effectiveCostPerQuery,
    };
  }

  /**
   * Get cost comparison between both systems.
   */
  getComparison(): { wiki: CostRecord; rag: CostRecord } {
    return {
      wiki: this.getCostRecord('wiki'),
      rag: this.getCostRecord('rag'),
    };
  }

  /**
   * Serialize all tracking data to JSON-compatible object.
   */
  toJSON(): { entries: CostEntry[]; summary: { wiki: CostRecord; rag: CostRecord } } {
    return {
      entries: [...this.entries],
      summary: this.getComparison(),
    };
  }

  /** Reset all tracked data. */
  reset(): void {
    this.entries = [];
    this.buildCosts.clear();
  }
}

// ── Latency Tracker ──────────────────────────────────────────────

/**
 * Tracks and computes latency percentiles for each system.
 */
export class LatencyTracker {
  private entries: LatencyEntry[] = [];

  /**
   * Record a latency sample.
   * Supports both (system, latencyMs) and (system, queryId, latencyMs) signatures.
   */
  record(system: 'wiki' | 'rag', queryIdOrLatency: string | number, latencyMs?: number): void {
    let actualQueryId: string;
    let actualLatency: number;

    if (typeof queryIdOrLatency === 'number') {
      // Short signature: record(system, latencyMs)
      actualQueryId = '';
      actualLatency = queryIdOrLatency;
    } else {
      // Full signature: record(system, queryId, latencyMs)
      actualQueryId = queryIdOrLatency;
      actualLatency = latencyMs!;
    }

    this.entries.push({
      system,
      queryId: actualQueryId,
      latencyMs: actualLatency,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Compute percentile from sorted array.
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0];
    const idx = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
  }

  /**
   * Get latency statistics for a system.
   */
  getStats(system: 'wiki' | 'rag'): LatencyStats {
    const samples = this.entries.filter((e) => e.system === system).map((e) => e.latencyMs);
    if (samples.length === 0) {
      return { system, count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const sum = sorted.reduce((s, v) => s + v, 0);

    return {
      system,
      count: sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: sum / sorted.length,
      p50: this.percentile(sorted, 50),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99),
    };
  }

  /**
   * Get latency comparison between both systems.
   */
  getComparison(): { wiki: LatencyStats; rag: LatencyStats } {
    return {
      wiki: this.getStats('wiki'),
      rag: this.getStats('rag'),
    };
  }

  /**
   * Serialize all tracking data to JSON-compatible object.
   */
  toJSON(): { entries: LatencyEntry[]; summary: { wiki: LatencyStats; rag: LatencyStats } } {
    return {
      entries: [...this.entries],
      summary: this.getComparison(),
    };
  }

  /** Reset all tracked data. */
  reset(): void {
    this.entries = [];
  }
}

// ── Factory Functions ────────────────────────────────────────────

/** Create a new CostTracker with optional custom pricing. */
export function createCostTracker(pricing?: Record<string, ModelPricing>): CostTracker {
  return new CostTracker(pricing);
}

/** Create a new LatencyTracker. */
export function createLatencyTracker(): LatencyTracker {
  return new LatencyTracker();
}
