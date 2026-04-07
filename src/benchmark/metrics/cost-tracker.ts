/**
 * Cost tracker — records token usage and calculates $/query.
 *
 * Tracks token consumption per system (wiki vs rag), supports
 * amortizing compilation cost over query count, and provides
 * per-query and aggregate cost breakdowns.
 */

import type { TokenUsage } from '../../types.ts';
import { createLogger } from '../../logger.ts';

const log = createLogger('cost-tracker');

// ── Pricing ──────────────────────────────────────────────────────

/** Token pricing per model (USD per 1K tokens). */
export interface ModelPricing {
  promptPer1k: number;
  completionPer1k: number;
}

/** Default pricing for common models. */
export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': { promptPer1k: 0.0025, completionPer1k: 0.01 },
  'gpt-4o-mini': { promptPer1k: 0.00015, completionPer1k: 0.0006 },
  'mock-gpt-4o-mini': { promptPer1k: 0.00015, completionPer1k: 0.0006 },
  'mock-gpt-4o': { promptPer1k: 0.0025, completionPer1k: 0.01 },
};

// ── Types ────────────────────────────────────────────────────────

/** A single cost entry for one operation. */
export interface CostEntry {
  /** Which system produced this cost */
  system: 'wiki' | 'rag' | 'eval';
  /** Operation type */
  operation: 'compilation' | 'query' | 'evaluation';
  /** Model used */
  model: string;
  /** Token usage */
  tokenUsage: TokenUsage;
  /** Calculated cost in USD */
  costUsd: number;
  /** Timestamp */
  timestamp: string;
  /** Optional query ID */
  queryId?: string;
}

/** Aggregate cost summary for a system. */
export interface CostSummary {
  /** Total cost in USD */
  totalCostUsd: number;
  /** Total tokens used */
  totalTokens: number;
  /** Total prompt tokens */
  totalPromptTokens: number;
  /** Total completion tokens */
  totalCompletionTokens: number;
  /** Number of queries tracked */
  queryCount: number;
  /** Average cost per query (compilation cost amortized) */
  avgCostPerQuery: number;
  /** Compilation cost (one-time for wiki) */
  compilationCostUsd: number;
  /** Query-only cost (no compilation) */
  queryCostUsd: number;
}

// ── CostTracker ──────────────────────────────────────────────────

/**
 * Tracks token usage and costs across benchmark runs.
 *
 * Supports:
 * - Per-query cost tracking for wiki and RAG systems
 * - Compilation cost amortization over query count
 * - Custom model pricing
 * - Aggregate summaries
 */
export class CostTracker {
  private entries: CostEntry[] = [];
  private pricing: Record<string, ModelPricing>;

  constructor(customPricing?: Record<string, ModelPricing>) {
    this.pricing = { ...DEFAULT_PRICING, ...customPricing };
  }

  /**
   * Calculate cost for a token usage record.
   */
  calculateCost(tokenUsage: TokenUsage, model: string): number {
    const price = this.pricing[model] ?? this.pricing['gpt-4o-mini']!;
    const promptCost = (tokenUsage.promptTokens / 1000) * price.promptPer1k;
    const completionCost = (tokenUsage.completionTokens / 1000) * price.completionPer1k;
    return promptCost + completionCost;
  }

  /**
   * Record a cost entry.
   */
  record(
    system: 'wiki' | 'rag' | 'eval',
    operation: 'compilation' | 'query' | 'evaluation',
    model: string,
    tokenUsage: TokenUsage,
    queryId?: string,
  ): CostEntry {
    const costUsd = this.calculateCost(tokenUsage, model);
    const entry: CostEntry = {
      system,
      operation,
      model,
      tokenUsage,
      costUsd,
      timestamp: new Date().toISOString(),
      queryId,
    };
    this.entries.push(entry);
    log.debug({ system, operation, costUsd, tokens: tokenUsage.totalTokens }, 'Cost recorded');
    return entry;
  }

  /**
   * Get cost summary for a specific system.
   */
  getSummary(system: 'wiki' | 'rag'): CostSummary {
    const systemEntries = this.entries.filter((e) => e.system === system);
    const compilationEntries = systemEntries.filter((e) => e.operation === 'compilation');
    const queryEntries = systemEntries.filter((e) => e.operation === 'query');

    const compilationCost = compilationEntries.reduce((sum, e) => sum + e.costUsd, 0);
    const queryCost = queryEntries.reduce((sum, e) => sum + e.costUsd, 0);
    const totalCost = systemEntries.reduce((sum, e) => sum + e.costUsd, 0);
    const totalTokens = systemEntries.reduce((sum, e) => sum + e.tokenUsage.totalTokens, 0);
    const totalPromptTokens = systemEntries.reduce((sum, e) => sum + e.tokenUsage.promptTokens, 0);
    const totalCompletionTokens = systemEntries.reduce((sum, e) => sum + e.tokenUsage.completionTokens, 0);
    const queryCount = new Set(queryEntries.map((e) => e.queryId).filter(Boolean)).size || queryEntries.length;

    return {
      totalCostUsd: totalCost,
      totalTokens,
      totalPromptTokens,
      totalCompletionTokens,
      queryCount,
      avgCostPerQuery: queryCount > 0 ? (compilationCost + queryCost) / queryCount : 0,
      compilationCostUsd: compilationCost,
      queryCostUsd: queryCost,
    };
  }

  /**
   * Get all recorded entries.
   */
  getEntries(): CostEntry[] {
    return [...this.entries];
  }

  /**
   * Get entries for a specific query.
   */
  getEntriesForQuery(queryId: string): CostEntry[] {
    return this.entries.filter((e) => e.queryId === queryId);
  }

  /**
   * Reset all tracked entries.
   */
  reset(): void {
    this.entries = [];
  }

  /**
   * Export cost data as a plain object for JSON serialization.
   */
  toJSON(): { entries: CostEntry[]; wikiSummary: CostSummary; ragSummary: CostSummary } {
    return {
      entries: this.entries,
      wikiSummary: this.getSummary('wiki'),
      ragSummary: this.getSummary('rag'),
    };
  }
}

/**
 * Create a new CostTracker instance.
 */
export function createCostTracker(customPricing?: Record<string, ModelPricing>): CostTracker {
  return new CostTracker(customPricing);
}
