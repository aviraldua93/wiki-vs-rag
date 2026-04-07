/**
 * Unit tests for src/benchmark/metrics/evaluator.ts
 *
 * Tests: RAGAS scoring, LLM-as-Judge scoring, winner determination.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  computeRagasScores,
  computeJudgeScores,
  determineWinner,
} from '../../src/benchmark/metrics/evaluator.ts';
import { MockLLM } from '../../src/providers/llm.ts';
import type { Query, Answer, JudgeScores } from '../../src/types.ts';

// Silence logger during tests
process.env.LOG_LEVEL = 'silent';

function makeQuery(overrides: Partial<Query> = {}): Query {
  return {
    id: 'test-query',
    text: 'What is the Meridian Data Platform?',
    expectedAnswer: 'A distributed data processing platform.',
    category: 'single-hop',
    ...overrides,
  };
}

function makeAnswer(overrides: Partial<Answer> = {}): Answer {
  return {
    queryId: 'test-query',
    text: 'Meridian is a distributed data processing platform that processes 2.3 billion events daily.',
    citations: [
      { source: 'System Architecture', excerpt: 'Meridian is distributed...', relevance: 0.9 },
    ],
    system: 'wiki',
    latencyMs: 150,
    ...overrides,
  };
}

describe('computeRagasScores', () => {
  let llm: MockLLM;

  beforeEach(() => {
    llm = new MockLLM();
  });

  test('returns scores for all four dimensions', async () => {
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

  test('calls LLM for evaluation (4 metrics)', async () => {
    await computeRagasScores(makeQuery(), makeAnswer(), llm);
    expect(llm.getCallCount()).toBe(4);
  });

  test('handles missing expected answer', async () => {
    const query = makeQuery({ expectedAnswer: undefined });
    const scores = await computeRagasScores(query, makeAnswer(), llm);
    // Should still return valid scores
    expect(scores.faithfulness).toBeGreaterThanOrEqual(0);
  });
});

describe('computeJudgeScores', () => {
  let llm: MockLLM;

  beforeEach(() => {
    llm = new MockLLM();
  });

  test('returns scores for all four dimensions plus reasoning', async () => {
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

  test('calls LLM for evaluation', async () => {
    await computeJudgeScores(makeQuery(), makeAnswer(), llm);
    expect(llm.getCallCount()).toBe(1);
  });
});

describe('determineWinner', () => {
  test('wiki wins when scores are higher', () => {
    const wikiScores: JudgeScores = {
      correctness: 0.9,
      completeness: 0.85,
      coherence: 0.9,
      citationQuality: 0.8,
    };
    const ragScores: JudgeScores = {
      correctness: 0.6,
      completeness: 0.5,
      coherence: 0.7,
      citationQuality: 0.4,
    };
    expect(determineWinner(wikiScores, ragScores)).toBe('wiki');
  });

  test('rag wins when scores are higher', () => {
    const wikiScores: JudgeScores = {
      correctness: 0.5,
      completeness: 0.4,
      coherence: 0.5,
      citationQuality: 0.3,
    };
    const ragScores: JudgeScores = {
      correctness: 0.9,
      completeness: 0.85,
      coherence: 0.9,
      citationQuality: 0.8,
    };
    expect(determineWinner(wikiScores, ragScores)).toBe('rag');
  });

  test('tie when scores are close', () => {
    const wikiScores: JudgeScores = {
      correctness: 0.8,
      completeness: 0.75,
      coherence: 0.85,
      citationQuality: 0.7,
    };
    const ragScores: JudgeScores = {
      correctness: 0.78,
      completeness: 0.77,
      coherence: 0.83,
      citationQuality: 0.72,
    };
    expect(determineWinner(wikiScores, ragScores)).toBe('tie');
  });

  test('tie when scores are identical', () => {
    const scores: JudgeScores = {
      correctness: 0.8,
      completeness: 0.8,
      coherence: 0.8,
      citationQuality: 0.8,
    };
    expect(determineWinner(scores, scores)).toBe('tie');
  });

  test('uses threshold of 0.05 for winner determination', () => {
    const higher: JudgeScores = {
      correctness: 0.8,
      completeness: 0.8,
      coherence: 0.8,
      citationQuality: 0.8,
    };
    const lower: JudgeScores = {
      correctness: 0.74,
      completeness: 0.74,
      coherence: 0.74,
      citationQuality: 0.74,
    };
    // Diff = 0.06 > 0.05 threshold → wiki wins
    expect(determineWinner(higher, lower)).toBe('wiki');
  });
});
