/**
 * Unit tests for RAGAS metrics, cost tracker, and latency tracker.
 *
 * Tests:
 * - Each RAGAS metric returns scores in [0,1] range
 * - LLM-as-Judge evaluator with rubric
 * - Cost tracker accumulates correctly
 * - Latency tracker computes p50/p95/p99
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  evaluateFaithfulness,
  evaluateAnswerRelevancy,
  evaluateContextPrecision,
  evaluateContextRecall,
  computeAllRagasMetrics,
} from '../../src/benchmark/metrics/ragas.ts';
import {
  computeRagasScores,
  computeJudgeScores,
  determineWinner,
  DEFAULT_JUDGE_RUBRIC,
} from '../../src/benchmark/metrics/evaluator.ts';
import { CostTracker, createCostTracker } from '../../src/benchmark/metrics/cost-tracker.ts';
import { LatencyTracker, createLatencyTracker } from '../../src/benchmark/metrics/latency-tracker.ts';
import { MockLLM } from '../../src/providers/llm.ts';
import type { Query, Answer, JudgeScores, TokenUsage } from '../../src/types.ts';

// Silence logger during tests
process.env.LOG_LEVEL = 'silent';

// ── Test Helpers ─────────────────────────────────────────────────

function makeQuery(overrides: Partial<Query> = {}): Query {
  return {
    id: 'test-q-1',
    text: 'What is the default rate limit for the Meridian API free tier?',
    expectedAnswer: '100 requests per minute and 10,000 requests per day.',
    category: 'single-hop',
    ...overrides,
  };
}

function makeAnswer(overrides: Partial<Answer> = {}): Answer {
  return {
    queryId: 'test-q-1',
    text: 'The Meridian API free tier has a rate limit of 100 requests per minute and 10,000 requests per day.',
    citations: [
      {
        source: 'API Reference',
        excerpt: 'Free tier: 100 req/min, 10,000 req/day.',
        relevance: 0.95,
      },
      {
        source: 'Configuration Guide',
        excerpt: 'Rate limits can be adjusted via the config file.',
        relevance: 0.7,
      },
    ],
    system: 'wiki',
    latencyMs: 120,
    tokenUsage: {
      promptTokens: 200,
      completionTokens: 50,
      totalTokens: 250,
    },
    ...overrides,
  };
}

function makeTokenUsage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    ...overrides,
  };
}

// ── RAGAS Individual Metrics ─────────────────────────────────────

describe('RAGAS Individual Metrics', () => {
  let llm: MockLLM;

  beforeEach(() => {
    llm = new MockLLM();
  });

  describe('evaluateFaithfulness', () => {
    test('returns score in [0,1] range', async () => {
      const result = await evaluateFaithfulness(makeQuery(), makeAnswer(), llm);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    test('returns metric name and explanation', async () => {
      const result = await evaluateFaithfulness(makeQuery(), makeAnswer(), llm);
      expect(result.metric).toBe('faithfulness');
      expect(result.explanation).toBeDefined();
      expect(typeof result.explanation).toBe('string');
    });

    test('calls LLM once', async () => {
      await evaluateFaithfulness(makeQuery(), makeAnswer(), llm);
      expect(llm.getCallCount()).toBe(1);
    });

    test('handles answer with no citations', async () => {
      const answer = makeAnswer({ citations: [] });
      const result = await evaluateFaithfulness(makeQuery(), answer, llm);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });
  });

  describe('evaluateAnswerRelevancy', () => {
    test('returns score in [0,1] range', async () => {
      const result = await evaluateAnswerRelevancy(makeQuery(), makeAnswer(), llm);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    test('returns metric name', async () => {
      const result = await evaluateAnswerRelevancy(makeQuery(), makeAnswer(), llm);
      expect(result.metric).toBe('answerRelevancy');
    });

    test('handles missing expected answer', async () => {
      const query = makeQuery({ expectedAnswer: undefined });
      const result = await evaluateAnswerRelevancy(query, makeAnswer(), llm);
      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('evaluateContextPrecision', () => {
    test('returns score in [0,1] range', async () => {
      const result = await evaluateContextPrecision(makeQuery(), makeAnswer(), llm);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    test('returns metric name', async () => {
      const result = await evaluateContextPrecision(makeQuery(), makeAnswer(), llm);
      expect(result.metric).toBe('contextPrecision');
    });
  });

  describe('evaluateContextRecall', () => {
    test('returns score in [0,1] range', async () => {
      const result = await evaluateContextRecall(makeQuery(), makeAnswer(), llm);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    test('returns metric name', async () => {
      const result = await evaluateContextRecall(makeQuery(), makeAnswer(), llm);
      expect(result.metric).toBe('contextRecall');
    });

    test('handles missing ground truth', async () => {
      const query = makeQuery({ expectedAnswer: undefined });
      const result = await evaluateContextRecall(query, makeAnswer(), llm);
      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });
});

// ── RAGAS Composite ──────────────────────────────────────────────

describe('computeAllRagasMetrics', () => {
  let llm: MockLLM;

  beforeEach(() => {
    llm = new MockLLM();
  });

  test('returns all four metric scores', async () => {
    const result = await computeAllRagasMetrics(makeQuery(), makeAnswer(), llm);
    expect(result.scores.faithfulness).toBeGreaterThanOrEqual(0);
    expect(result.scores.faithfulness).toBeLessThanOrEqual(1);
    expect(result.scores.answerRelevancy).toBeGreaterThanOrEqual(0);
    expect(result.scores.answerRelevancy).toBeLessThanOrEqual(1);
    expect(result.scores.contextPrecision).toBeGreaterThanOrEqual(0);
    expect(result.scores.contextPrecision).toBeLessThanOrEqual(1);
    expect(result.scores.contextRecall).toBeGreaterThanOrEqual(0);
    expect(result.scores.contextRecall).toBeLessThanOrEqual(1);
  });

  test('returns detailed metric results', async () => {
    const result = await computeAllRagasMetrics(makeQuery(), makeAnswer(), llm);
    expect(result.details).toHaveLength(4);
    const metrics = result.details.map((d) => d.metric);
    expect(metrics).toContain('faithfulness');
    expect(metrics).toContain('answerRelevancy');
    expect(metrics).toContain('contextPrecision');
    expect(metrics).toContain('contextRecall');
  });

  test('calls LLM four times (one per metric)', async () => {
    await computeAllRagasMetrics(makeQuery(), makeAnswer(), llm);
    expect(llm.getCallCount()).toBe(4);
  });
});

// ── Evaluator (integrated RAGAS + Judge) ─────────────────────────

describe('computeRagasScores (integrated)', () => {
  let llm: MockLLM;

  beforeEach(() => {
    llm = new MockLLM();
  });

  test('returns all four RAGAS dimensions in [0,1]', async () => {
    const scores = await computeRagasScores(makeQuery(), makeAnswer(), llm);
    expect(scores.faithfulness).toBeGreaterThanOrEqual(0);
    expect(scores.faithfulness).toBeLessThanOrEqual(1);
    expect(scores.answerRelevancy).toBeGreaterThanOrEqual(0);
    expect(scores.answerRelevancy).toBeLessThanOrEqual(1);
    expect(scores.contextRelevancy).toBeGreaterThanOrEqual(0);
    expect(scores.contextRelevancy).toBeLessThanOrEqual(1);
    expect(scores.contextPrecision).toBeGreaterThanOrEqual(0);
    expect(scores.contextPrecision).toBeLessThanOrEqual(1);
  });
});

describe('computeJudgeScores (integrated)', () => {
  let llm: MockLLM;

  beforeEach(() => {
    llm = new MockLLM();
  });

  test('returns all four judge dimensions plus reasoning', async () => {
    const scores = await computeJudgeScores(makeQuery(), makeAnswer(), llm);
    expect(scores.correctness).toBeGreaterThanOrEqual(0);
    expect(scores.correctness).toBeLessThanOrEqual(1);
    expect(scores.completeness).toBeGreaterThanOrEqual(0);
    expect(scores.completeness).toBeLessThanOrEqual(1);
    expect(scores.coherence).toBeGreaterThanOrEqual(0);
    expect(scores.coherence).toBeLessThanOrEqual(1);
    expect(scores.citationQuality).toBeGreaterThanOrEqual(0);
    expect(scores.citationQuality).toBeLessThanOrEqual(1);
    expect(scores.reasoning).toBeDefined();
  });

  test('accepts custom rubric', async () => {
    const customRubric = {
      ...DEFAULT_JUDGE_RUBRIC,
      name: 'custom-rubric',
    };
    const scores = await computeJudgeScores(makeQuery(), makeAnswer(), llm, customRubric);
    expect(scores.correctness).toBeGreaterThanOrEqual(0);
  });

  test('handles RAG system answer', async () => {
    const ragAnswer = makeAnswer({ system: 'rag' });
    const scores = await computeJudgeScores(makeQuery(), ragAnswer, llm);
    expect(scores.correctness).toBeGreaterThanOrEqual(0);
  });
});

describe('determineWinner', () => {
  test('wiki wins with clearly higher scores', () => {
    const wiki: JudgeScores = { correctness: 0.9, completeness: 0.9, coherence: 0.9, citationQuality: 0.9 };
    const rag: JudgeScores = { correctness: 0.5, completeness: 0.5, coherence: 0.5, citationQuality: 0.5 };
    expect(determineWinner(wiki, rag)).toBe('wiki');
  });

  test('rag wins with clearly higher scores', () => {
    const wiki: JudgeScores = { correctness: 0.3, completeness: 0.3, coherence: 0.3, citationQuality: 0.3 };
    const rag: JudgeScores = { correctness: 0.9, completeness: 0.9, coherence: 0.9, citationQuality: 0.9 };
    expect(determineWinner(wiki, rag)).toBe('rag');
  });

  test('tie when within threshold', () => {
    const wiki: JudgeScores = { correctness: 0.8, completeness: 0.8, coherence: 0.8, citationQuality: 0.8 };
    const rag: JudgeScores = { correctness: 0.78, completeness: 0.78, coherence: 0.78, citationQuality: 0.78 };
    expect(determineWinner(wiki, rag)).toBe('tie');
  });

  test('accepts custom threshold', () => {
    const wiki: JudgeScores = { correctness: 0.8, completeness: 0.8, coherence: 0.8, citationQuality: 0.8 };
    const rag: JudgeScores = { correctness: 0.7, completeness: 0.7, coherence: 0.7, citationQuality: 0.7 };
    // Default threshold 0.05 → wiki wins (diff = 0.1)
    expect(determineWinner(wiki, rag)).toBe('wiki');
    // Custom threshold 0.15 → tie (diff = 0.1 < 0.15)
    expect(determineWinner(wiki, rag, 0.15)).toBe('tie');
  });
});

// ── Cost Tracker ─────────────────────────────────────────────────

describe('CostTracker', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = createCostTracker();
  });

  test('calculates cost from token usage', () => {
    const cost = tracker.calculateCost(makeTokenUsage(), 'gpt-4o-mini');
    expect(cost).toBeGreaterThan(0);
    // Verify exact math: 100/1000 * 0.00015 + 50/1000 * 0.0006 = 0.000015 + 0.00003 = 0.000045
    expect(cost).toBeCloseTo(0.000045, 6);
  });

  test('records cost entries', () => {
    tracker.record('wiki', 'query', 'gpt-4o-mini', makeTokenUsage(), 'q-1');
    tracker.record('wiki', 'query', 'gpt-4o-mini', makeTokenUsage(), 'q-2');
    expect(tracker.getEntries()).toHaveLength(2);
  });

  test('accumulates costs across entries', () => {
    tracker.record('wiki', 'query', 'gpt-4o-mini', makeTokenUsage(), 'q-1');
    tracker.record('wiki', 'query', 'gpt-4o-mini', makeTokenUsage(), 'q-2');
    const summary = tracker.getSummary('wiki');
    expect(summary.totalCostUsd).toBeCloseTo(0.000045 * 2, 6);
    expect(summary.totalTokens).toBe(300);
    expect(summary.queryCount).toBe(2);
  });

  test('separates wiki and rag costs', () => {
    tracker.record('wiki', 'query', 'gpt-4o-mini', makeTokenUsage(), 'q-1');
    tracker.record('rag', 'query', 'gpt-4o-mini', makeTokenUsage({ promptTokens: 200, completionTokens: 100, totalTokens: 300 }), 'q-1');

    const wikiSummary = tracker.getSummary('wiki');
    const ragSummary = tracker.getSummary('rag');

    expect(wikiSummary.totalTokens).toBe(150);
    expect(ragSummary.totalTokens).toBe(300);
  });

  test('computes average cost per query with compilation amortization', () => {
    // Record compilation cost
    tracker.record('wiki', 'compilation', 'gpt-4o-mini', makeTokenUsage({ promptTokens: 1000, completionTokens: 500, totalTokens: 1500 }));
    // Record 5 query costs
    for (let i = 0; i < 5; i++) {
      tracker.record('wiki', 'query', 'gpt-4o-mini', makeTokenUsage(), `q-${i}`);
    }

    const summary = tracker.getSummary('wiki');
    expect(summary.queryCount).toBe(5);
    expect(summary.compilationCostUsd).toBeGreaterThan(0);
    expect(summary.queryCostUsd).toBeGreaterThan(0);
    expect(summary.avgCostPerQuery).toBeGreaterThan(0);
    // avgCostPerQuery = (compilation + query) / queryCount
    expect(summary.avgCostPerQuery).toBeCloseTo(
      (summary.compilationCostUsd + summary.queryCostUsd) / 5,
      6,
    );
  });

  test('uses gpt-4o pricing for gpt-4o model', () => {
    const cost = tracker.calculateCost(makeTokenUsage(), 'gpt-4o');
    // gpt-4o: 100/1000 * 0.0025 + 50/1000 * 0.01 = 0.00025 + 0.0005 = 0.00075
    expect(cost).toBeCloseTo(0.00075, 6);
  });

  test('falls back to gpt-4o-mini pricing for unknown models', () => {
    const cost = tracker.calculateCost(makeTokenUsage(), 'unknown-model');
    expect(cost).toBeCloseTo(0.000045, 6);
  });

  test('supports custom pricing', () => {
    const customTracker = createCostTracker({
      'custom-model': { promptPer1k: 0.01, completionPer1k: 0.02 },
    });
    const cost = customTracker.calculateCost(makeTokenUsage(), 'custom-model');
    // 100/1000 * 0.01 + 50/1000 * 0.02 = 0.001 + 0.001 = 0.002
    expect(cost).toBeCloseTo(0.002, 6);
  });

  test('getEntriesForQuery filters correctly', () => {
    tracker.record('wiki', 'query', 'gpt-4o-mini', makeTokenUsage(), 'q-1');
    tracker.record('wiki', 'query', 'gpt-4o-mini', makeTokenUsage(), 'q-2');
    tracker.record('rag', 'query', 'gpt-4o-mini', makeTokenUsage(), 'q-1');

    const entries = tracker.getEntriesForQuery('q-1');
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.queryId === 'q-1')).toBe(true);
  });

  test('reset clears all entries', () => {
    tracker.record('wiki', 'query', 'gpt-4o-mini', makeTokenUsage(), 'q-1');
    tracker.reset();
    expect(tracker.getEntries()).toHaveLength(0);
  });

  test('toJSON returns complete cost data', () => {
    tracker.record('wiki', 'query', 'gpt-4o-mini', makeTokenUsage(), 'q-1');
    tracker.record('rag', 'query', 'gpt-4o-mini', makeTokenUsage(), 'q-1');
    const json = tracker.toJSON();
    expect(json.entries).toHaveLength(2);
    expect(json.wikiSummary).toBeDefined();
    expect(json.ragSummary).toBeDefined();
    expect(json.wikiSummary.totalCostUsd).toBeGreaterThan(0);
  });

  test('handles empty tracker gracefully', () => {
    const summary = tracker.getSummary('wiki');
    expect(summary.totalCostUsd).toBe(0);
    expect(summary.totalTokens).toBe(0);
    expect(summary.queryCount).toBe(0);
    expect(summary.avgCostPerQuery).toBe(0);
  });
});

// ── Latency Tracker ──────────────────────────────────────────────

describe('LatencyTracker', () => {
  let tracker: LatencyTracker;

  beforeEach(() => {
    tracker = createLatencyTracker();
  });

  test('records latency entries', () => {
    tracker.record('wiki', 'q-1', 100);
    tracker.record('wiki', 'q-2', 200);
    expect(tracker.getEntries()).toHaveLength(2);
  });

  test('computes correct p50 (median)', () => {
    // Record sorted: [50, 100, 150, 200, 250]
    tracker.record('wiki', 'q-1', 100);
    tracker.record('wiki', 'q-2', 200);
    tracker.record('wiki', 'q-3', 50);
    tracker.record('wiki', 'q-4', 250);
    tracker.record('wiki', 'q-5', 150);

    const stats = tracker.getStats('wiki');
    expect(stats.p50Ms).toBe(150); // Middle value
  });

  test('computes correct p95 and p99', () => {
    // Record 100 entries: 1ms to 100ms
    for (let i = 1; i <= 100; i++) {
      tracker.record('wiki', `q-${i}`, i);
    }

    const stats = tracker.getStats('wiki');
    expect(stats.p50Ms).toBeCloseTo(50.5, 1);
    expect(stats.p95Ms).toBeCloseTo(95.05, 1);
    expect(stats.p99Ms).toBeCloseTo(99.01, 1);
  });

  test('computes min, max, mean', () => {
    tracker.record('wiki', 'q-1', 100);
    tracker.record('wiki', 'q-2', 200);
    tracker.record('wiki', 'q-3', 300);

    const stats = tracker.getStats('wiki');
    expect(stats.minMs).toBe(100);
    expect(stats.maxMs).toBe(300);
    expect(stats.meanMs).toBe(200);
    expect(stats.count).toBe(3);
  });

  test('separates wiki and rag stats', () => {
    tracker.record('wiki', 'q-1', 100);
    tracker.record('wiki', 'q-2', 200);
    tracker.record('rag', 'q-1', 50);
    tracker.record('rag', 'q-2', 150);

    const wikiStats = tracker.getStats('wiki');
    const ragStats = tracker.getStats('rag');

    expect(wikiStats.meanMs).toBe(150);
    expect(ragStats.meanMs).toBe(100);
    expect(wikiStats.count).toBe(2);
    expect(ragStats.count).toBe(2);
  });

  test('handles single entry', () => {
    tracker.record('wiki', 'q-1', 42);
    const stats = tracker.getStats('wiki');
    expect(stats.p50Ms).toBe(42);
    expect(stats.p95Ms).toBe(42);
    expect(stats.p99Ms).toBe(42);
    expect(stats.minMs).toBe(42);
    expect(stats.maxMs).toBe(42);
  });

  test('handles empty tracker', () => {
    const stats = tracker.getStats('wiki');
    expect(stats.count).toBe(0);
    expect(stats.p50Ms).toBe(0);
    expect(stats.p95Ms).toBe(0);
    expect(stats.p99Ms).toBe(0);
  });

  test('reset clears all entries', () => {
    tracker.record('wiki', 'q-1', 100);
    tracker.reset();
    expect(tracker.getEntries()).toHaveLength(0);
    expect(tracker.getStats('wiki').count).toBe(0);
  });

  test('toJSON returns complete latency data', () => {
    tracker.record('wiki', 'q-1', 100);
    tracker.record('rag', 'q-1', 200);
    const json = tracker.toJSON();
    expect(json.entries).toHaveLength(2);
    expect(json.wikiStats).toBeDefined();
    expect(json.ragStats).toBeDefined();
    expect(json.wikiStats.count).toBe(1);
    expect(json.ragStats.count).toBe(1);
  });
});
