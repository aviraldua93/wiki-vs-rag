/**
 * Unit tests for RAGAS metrics, LLM-as-Judge evaluator,
 * and cost/latency trackers.
 *
 * Tests all four RAGAS metrics (faithfulness, answer relevancy,
 * context precision, context recall), the judge evaluator with rubric,
 * the cost tracker with token accumulation, and the latency tracker
 * with percentile calculations.
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
  evaluateWithJudge,
  DEFAULT_JUDGE_RUBRIC,
} from '../../src/benchmark/metrics/judge.ts';
import type { JudgeRubric } from '../../src/benchmark/metrics/judge.ts';
import {
  CostTracker,
  LatencyTracker,
  createCostTracker,
  createLatencyTracker,
  DEFAULT_PRICING,
} from '../../src/benchmark/metrics/cost-latency.ts';
import { MockLLM } from '../../src/providers/llm.ts';
import type { Query, Answer, TokenUsage } from '../../src/types.ts';

// Silence logger during tests
process.env.LOG_LEVEL = 'silent';

// ── Test Helpers ─────────────────────────────────────────────────

function makeQuery(overrides: Partial<Query> = {}): Query {
  return {
    id: 'test-query-1',
    text: 'What is the default rate limit for the Meridian API?',
    expectedAnswer: '100 requests per minute and 10,000 requests per day.',
    category: 'single-hop',
    ...overrides,
  };
}

function makeAnswer(overrides: Partial<Answer> = {}): Answer {
  return {
    queryId: 'test-query-1',
    text: 'The Meridian API free tier has a rate limit of 100 requests per minute.',
    citations: [
      {
        source: 'API Reference',
        excerpt: 'Rate limit: 100 req/min for free tier',
        relevance: 0.92,
      },
      {
        source: 'Getting Started Guide',
        excerpt: 'All API endpoints are rate-limited.',
        relevance: 0.75,
      },
    ],
    system: 'wiki',
    latencyMs: 250,
    tokenUsage: {
      promptTokens: 500,
      completionTokens: 100,
      totalTokens: 600,
    },
    ...overrides,
  };
}

function makeTokenUsage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    promptTokens: 1000,
    completionTokens: 200,
    totalTokens: 1200,
    ...overrides,
  };
}

// ── RAGAS Metrics Tests ──────────────────────────────────────────

describe('RAGAS Metrics', () => {
  let llm: MockLLM;

  beforeEach(() => {
    llm = new MockLLM();
  });

  describe('evaluateFaithfulness', () => {
    test('returns a score between 0 and 1', async () => {
      const result = await evaluateFaithfulness(makeQuery(), makeAnswer(), llm);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    test('returns metric name as faithfulness', async () => {
      const result = await evaluateFaithfulness(makeQuery(), makeAnswer(), llm);
      expect(result.metric).toBe('faithfulness');
    });

    test('includes an explanation', async () => {
      const result = await evaluateFaithfulness(makeQuery(), makeAnswer(), llm);
      expect(result.explanation).toBeDefined();
      expect(typeof result.explanation).toBe('string');
    });

    test('calls LLM exactly once', async () => {
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
    test('returns a score between 0 and 1', async () => {
      const result = await evaluateAnswerRelevancy(makeQuery(), makeAnswer(), llm);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    test('returns metric name as answerRelevancy', async () => {
      const result = await evaluateAnswerRelevancy(makeQuery(), makeAnswer(), llm);
      expect(result.metric).toBe('answerRelevancy');
    });

    test('calls LLM exactly once', async () => {
      await evaluateAnswerRelevancy(makeQuery(), makeAnswer(), llm);
      expect(llm.getCallCount()).toBe(1);
    });
  });

  describe('evaluateContextPrecision', () => {
    test('returns a score between 0 and 1', async () => {
      const result = await evaluateContextPrecision(makeQuery(), makeAnswer(), llm);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    test('returns metric name as contextPrecision', async () => {
      const result = await evaluateContextPrecision(makeQuery(), makeAnswer(), llm);
      expect(result.metric).toBe('contextPrecision');
    });

    test('calls LLM exactly once', async () => {
      await evaluateContextPrecision(makeQuery(), makeAnswer(), llm);
      expect(llm.getCallCount()).toBe(1);
    });
  });

  describe('evaluateContextRecall', () => {
    test('returns a score between 0 and 1', async () => {
      const result = await evaluateContextRecall(makeQuery(), makeAnswer(), llm);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    test('returns metric name as contextRecall', async () => {
      const result = await evaluateContextRecall(makeQuery(), makeAnswer(), llm);
      expect(result.metric).toBe('contextRecall');
    });

    test('handles missing expected answer for recall', async () => {
      const query = makeQuery({ expectedAnswer: undefined });
      const result = await evaluateContextRecall(query, makeAnswer(), llm);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    test('calls LLM exactly once', async () => {
      await evaluateContextRecall(makeQuery(), makeAnswer(), llm);
      expect(llm.getCallCount()).toBe(1);
    });
  });

  describe('computeAllRagasMetrics', () => {
    test('returns all four RAGAS scores', async () => {
      const { scores } = await computeAllRagasMetrics(makeQuery(), makeAnswer(), llm);
      expect(scores.faithfulness).toBeGreaterThanOrEqual(0);
      expect(scores.faithfulness).toBeLessThanOrEqual(1);
      expect(scores.answerRelevancy).toBeGreaterThanOrEqual(0);
      expect(scores.answerRelevancy).toBeLessThanOrEqual(1);
      expect(scores.contextPrecision).toBeGreaterThanOrEqual(0);
      expect(scores.contextPrecision).toBeLessThanOrEqual(1);
      expect(scores.contextRecall).toBeGreaterThanOrEqual(0);
      expect(scores.contextRecall).toBeLessThanOrEqual(1);
    });

    test('returns detailed results for all four metrics', async () => {
      const { details } = await computeAllRagasMetrics(makeQuery(), makeAnswer(), llm);
      expect(details).toHaveLength(4);
      const metricNames = details.map((d) => d.metric);
      expect(metricNames).toContain('faithfulness');
      expect(metricNames).toContain('answerRelevancy');
      expect(metricNames).toContain('contextPrecision');
      expect(metricNames).toContain('contextRecall');
    });

    test('makes 4 LLM calls (one per metric)', async () => {
      await computeAllRagasMetrics(makeQuery(), makeAnswer(), llm);
      expect(llm.getCallCount()).toBe(4);
    });

    test('works with both wiki and rag answers', async () => {
      const wikiAnswer = makeAnswer({ system: 'wiki' });
      const ragAnswer = makeAnswer({ system: 'rag' });

      const wikiResult = await computeAllRagasMetrics(makeQuery(), wikiAnswer, llm);
      const ragResult = await computeAllRagasMetrics(makeQuery(), ragAnswer, llm);

      expect(wikiResult.scores.faithfulness).toBeGreaterThanOrEqual(0);
      expect(ragResult.scores.faithfulness).toBeGreaterThanOrEqual(0);
    });
  });
});

// ── Judge Evaluator Tests ────────────────────────────────────────

describe('LLM-as-Judge Evaluator', () => {
  let llm: MockLLM;

  beforeEach(() => {
    llm = new MockLLM();
  });

  describe('evaluateWithJudge', () => {
    test('returns scores for all four dimensions', async () => {
      const result = await evaluateWithJudge(makeQuery(), makeAnswer(), llm);
      expect(result.scores.correctness).toBeGreaterThanOrEqual(0);
      expect(result.scores.correctness).toBeLessThanOrEqual(1);
      expect(result.scores.completeness).toBeGreaterThanOrEqual(0);
      expect(result.scores.completeness).toBeLessThanOrEqual(1);
      expect(result.scores.coherence).toBeGreaterThanOrEqual(0);
      expect(result.scores.coherence).toBeLessThanOrEqual(1);
      expect(result.scores.citationQuality).toBeGreaterThanOrEqual(0);
      expect(result.scores.citationQuality).toBeLessThanOrEqual(1);
    });

    test('includes reasoning', async () => {
      const result = await evaluateWithJudge(makeQuery(), makeAnswer(), llm);
      expect(result.scores.reasoning).toBeDefined();
      expect(typeof result.scores.reasoning).toBe('string');
      expect(result.overallReasoning).toBeDefined();
    });

    test('returns dimension details', async () => {
      const result = await evaluateWithJudge(makeQuery(), makeAnswer(), llm);
      expect(result.dimensionDetails).toHaveLength(4);
      const dimensions = result.dimensionDetails.map((d) => d.dimension);
      expect(dimensions).toContain('correctness');
      expect(dimensions).toContain('completeness');
      expect(dimensions).toContain('coherence');
      expect(dimensions).toContain('citationQuality');
    });

    test('calls LLM exactly once', async () => {
      await evaluateWithJudge(makeQuery(), makeAnswer(), llm);
      expect(llm.getCallCount()).toBe(1);
    });

    test('uses default rubric when none provided', async () => {
      const result = await evaluateWithJudge(makeQuery(), makeAnswer(), llm);
      expect(result.dimensionDetails).toHaveLength(DEFAULT_JUDGE_RUBRIC.dimensions.length);
    });

    test('accepts custom rubric', async () => {
      const customRubric: JudgeRubric = {
        name: 'custom-rubric',
        dimensions: [
          {
            name: 'correctness',
            description: 'Custom correctness definition',
            anchors: { low: 'bad', mid: 'ok', high: 'good' },
          },
          {
            name: 'completeness',
            description: 'Custom completeness definition',
            anchors: { low: 'bad', mid: 'ok', high: 'good' },
          },
          {
            name: 'coherence',
            description: 'Custom coherence definition',
            anchors: { low: 'bad', mid: 'ok', high: 'good' },
          },
          {
            name: 'citationQuality',
            description: 'Custom citation quality definition',
            anchors: { low: 'bad', mid: 'ok', high: 'good' },
          },
        ],
      };

      const result = await evaluateWithJudge(makeQuery(), makeAnswer(), llm, customRubric);
      expect(result.dimensionDetails).toHaveLength(4);
    });

    test('handles both wiki and rag answers', async () => {
      const wikiResult = await evaluateWithJudge(
        makeQuery(),
        makeAnswer({ system: 'wiki' }),
        llm,
      );
      const ragResult = await evaluateWithJudge(
        makeQuery(),
        makeAnswer({ system: 'rag' }),
        llm,
      );

      expect(wikiResult.scores.correctness).toBeGreaterThanOrEqual(0);
      expect(ragResult.scores.correctness).toBeGreaterThanOrEqual(0);
    });

    test('handles answer with no citations', async () => {
      const answer = makeAnswer({ citations: [] });
      const result = await evaluateWithJudge(makeQuery(), answer, llm);
      expect(result.scores.citationQuality).toBeGreaterThanOrEqual(0);
      expect(result.scores.citationQuality).toBeLessThanOrEqual(1);
    });
  });
});

// ── Cost Tracker Tests ───────────────────────────────────────────

describe('CostTracker', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = createCostTracker();
  });

  test('calculateCost returns correct cost for known model', () => {
    const usage = makeTokenUsage({ promptTokens: 1_000_000, completionTokens: 1_000_000 });
    const cost = tracker.calculateCost(usage, 'gpt-4o-mini');
    // gpt-4o-mini: $0.15 input + $0.60 output per 1M tokens
    expect(cost).toBeCloseTo(0.15 + 0.60, 2);
  });

  test('calculateCost uses fallback for unknown model', () => {
    const usage = makeTokenUsage({ promptTokens: 1000, completionTokens: 200 });
    const cost = tracker.calculateCost(usage, 'unknown-model');
    expect(cost).toBeGreaterThan(0);
  });

  test('recordQuery accumulates costs correctly', () => {
    const usage1 = makeTokenUsage({ promptTokens: 500, completionTokens: 100 });
    const usage2 = makeTokenUsage({ promptTokens: 300, completionTokens: 50 });

    tracker.recordQuery('wiki', usage1, 'gpt-4o-mini');
    tracker.recordQuery('wiki', usage2, 'gpt-4o-mini');

    const record = tracker.getCostRecord('wiki');
    expect(record.totalPromptTokens).toBe(800);
    expect(record.totalCompletionTokens).toBe(150);
    expect(record.queryCount).toBe(2);
    expect(record.totalCostUsd).toBeGreaterThan(0);
    expect(record.avgCostPerQuery).toBeCloseTo(record.totalCostUsd / 2, 10);
  });

  test('recordBuildCost is amortized over queries', () => {
    const buildUsage = makeTokenUsage({ promptTokens: 100000, completionTokens: 50000 });
    tracker.recordBuildCost('wiki', buildUsage, 'gpt-4o-mini');

    const queryUsage = makeTokenUsage({ promptTokens: 500, completionTokens: 100 });
    tracker.recordQuery('wiki', queryUsage, 'gpt-4o-mini');
    tracker.recordQuery('wiki', queryUsage, 'gpt-4o-mini');

    const record = tracker.getCostRecord('wiki');
    expect(record.buildCostUsd).toBeGreaterThan(0);
    expect(record.effectiveCostPerQuery).toBeGreaterThan(record.avgCostPerQuery);
    expect(record.effectiveCostPerQuery).toBeCloseTo(
      record.avgCostPerQuery + record.buildCostUsd / record.queryCount,
      10,
    );
  });

  test('tracks wiki and rag systems independently', () => {
    const usage = makeTokenUsage({ promptTokens: 1000, completionTokens: 200 });
    tracker.recordQuery('wiki', usage, 'gpt-4o-mini');
    tracker.recordQuery('rag', usage, 'gpt-4o');

    const wikiRecord = tracker.getCostRecord('wiki');
    const ragRecord = tracker.getCostRecord('rag');

    expect(wikiRecord.queryCount).toBe(1);
    expect(ragRecord.queryCount).toBe(1);
    // RAG with gpt-4o should be more expensive than wiki with gpt-4o-mini
    expect(ragRecord.totalCostUsd).toBeGreaterThan(wikiRecord.totalCostUsd);
  });

  test('getComparison returns both systems', () => {
    tracker.recordQuery('wiki', makeTokenUsage(), 'gpt-4o-mini');
    tracker.recordQuery('rag', makeTokenUsage(), 'gpt-4o');

    const comparison = tracker.getComparison();
    expect(comparison.wiki.system).toBe('wiki');
    expect(comparison.rag.system).toBe('rag');
    expect(comparison.wiki.queryCount).toBe(1);
    expect(comparison.rag.queryCount).toBe(1);
  });

  test('returns zero records for untracked system', () => {
    const record = tracker.getCostRecord('wiki');
    expect(record.queryCount).toBe(0);
    expect(record.totalCostUsd).toBe(0);
    expect(record.totalPromptTokens).toBe(0);
  });

  test('reset clears all tracked data', () => {
    tracker.recordQuery('wiki', makeTokenUsage(), 'gpt-4o-mini');
    tracker.reset();

    const record = tracker.getCostRecord('wiki');
    expect(record.queryCount).toBe(0);
    expect(record.totalCostUsd).toBe(0);
  });

  test('supports custom pricing', () => {
    const customTracker = createCostTracker({
      'custom-model': { inputPer1M: 1.00, outputPer1M: 2.00 },
    });
    const usage = makeTokenUsage({ promptTokens: 1_000_000, completionTokens: 1_000_000 });
    const cost = customTracker.calculateCost(usage, 'custom-model');
    expect(cost).toBeCloseTo(3.00, 2);
  });
});

// ── Latency Tracker Tests ────────────────────────────────────────

describe('LatencyTracker', () => {
  let tracker: LatencyTracker;

  beforeEach(() => {
    tracker = createLatencyTracker();
  });

  test('computes correct stats for single sample', () => {
    tracker.record('wiki', 150);
    const stats = tracker.getStats('wiki');
    expect(stats.count).toBe(1);
    expect(stats.min).toBe(150);
    expect(stats.max).toBe(150);
    expect(stats.mean).toBe(150);
    expect(stats.p50).toBe(150);
    expect(stats.p95).toBe(150);
    expect(stats.p99).toBe(150);
  });

  test('computes correct stats for multiple samples', () => {
    const samples = [100, 200, 150, 300, 250, 120, 180, 220, 160, 190];
    for (const s of samples) {
      tracker.record('wiki', s);
    }

    const stats = tracker.getStats('wiki');
    expect(stats.count).toBe(10);
    expect(stats.min).toBe(100);
    expect(stats.max).toBe(300);
    expect(stats.mean).toBeCloseTo(187, 0);
    expect(stats.p50).toBeGreaterThanOrEqual(100);
    expect(stats.p50).toBeLessThanOrEqual(300);
  });

  test('p50 is the median', () => {
    // Odd number of samples: 100, 200, 300, 400, 500
    for (const s of [100, 200, 300, 400, 500]) {
      tracker.record('wiki', s);
    }
    const stats = tracker.getStats('wiki');
    expect(stats.p50).toBe(300);
  });

  test('p95 and p99 are high percentiles', () => {
    for (let i = 1; i <= 100; i++) {
      tracker.record('wiki', i);
    }
    const stats = tracker.getStats('wiki');
    expect(stats.p95).toBeGreaterThanOrEqual(94);
    expect(stats.p95).toBeLessThanOrEqual(96);
    expect(stats.p99).toBeGreaterThanOrEqual(98);
    expect(stats.p99).toBeLessThanOrEqual(100);
  });

  test('tracks wiki and rag independently', () => {
    tracker.record('wiki', 100);
    tracker.record('wiki', 200);
    tracker.record('rag', 300);

    const wikiStats = tracker.getStats('wiki');
    const ragStats = tracker.getStats('rag');

    expect(wikiStats.count).toBe(2);
    expect(ragStats.count).toBe(1);
    expect(wikiStats.mean).toBeCloseTo(150, 0);
    expect(ragStats.mean).toBe(300);
  });

  test('getComparison returns both systems', () => {
    tracker.record('wiki', 100);
    tracker.record('rag', 200);

    const comparison = tracker.getComparison();
    expect(comparison.wiki.system).toBe('wiki');
    expect(comparison.rag.system).toBe('rag');
  });

  test('returns zero stats for untracked system', () => {
    const stats = tracker.getStats('wiki');
    expect(stats.count).toBe(0);
    expect(stats.min).toBe(0);
    expect(stats.max).toBe(0);
    expect(stats.mean).toBe(0);
    expect(stats.p50).toBe(0);
    expect(stats.p95).toBe(0);
    expect(stats.p99).toBe(0);
  });

  test('reset clears all tracked data', () => {
    tracker.record('wiki', 100);
    tracker.reset();

    const stats = tracker.getStats('wiki');
    expect(stats.count).toBe(0);
  });
});
