/**
 * Unit tests for src/benchmark/datasets/test-queries.ts
 *
 * Tests: Q&A pair generation, test query creation, category coverage.
 */

import { describe, test, expect } from 'bun:test';
import {
  createTestQueries,
  queriesToBenchmark,
} from '../../src/benchmark/datasets/test-queries.ts';
import type { QAPair } from '../../src/benchmark/datasets/test-queries.ts';

// Silence logger during tests
process.env.LOG_LEVEL = 'silent';

describe('queriesToBenchmark', () => {
  test('converts Q&A pairs to Query objects', () => {
    const pairs: QAPair[] = [
      {
        question: 'What is the Meridian API rate limit?',
        expectedAnswer: '100 requests per minute.',
        category: 'single-hop',
        sourceDocIds: ['technical-api-reference'],
      },
    ];

    const queries = queriesToBenchmark(pairs);
    expect(queries).toHaveLength(1);
    expect(queries[0].text).toBe('What is the Meridian API rate limit?');
    expect(queries[0].expectedAnswer).toBe('100 requests per minute.');
    expect(queries[0].category).toBe('single-hop');
    expect(queries[0].id).toBeDefined();
    expect(queries[0].id.length).toBeGreaterThan(0);
  });

  test('generates unique IDs for each query', () => {
    const pairs: QAPair[] = [
      { question: 'Q1', expectedAnswer: 'A1', category: 'single-hop', sourceDocIds: [] },
      { question: 'Q2', expectedAnswer: 'A2', category: 'multi-hop', sourceDocIds: [] },
    ];

    const queries = queriesToBenchmark(pairs);
    expect(queries[0].id).not.toBe(queries[1].id);
  });

  test('preserves source document IDs in metadata', () => {
    const pairs: QAPair[] = [
      {
        question: 'Q',
        expectedAnswer: 'A',
        category: 'multi-hop',
        sourceDocIds: ['doc-a', 'doc-b'],
      },
    ];

    const queries = queriesToBenchmark(pairs);
    const meta = queries[0].metadata as { sourceDocIds: string[] };
    expect(meta.sourceDocIds).toEqual(['doc-a', 'doc-b']);
  });

  test('handles empty pairs array', () => {
    const queries = queriesToBenchmark([]);
    expect(queries).toEqual([]);
  });
});

describe('createTestQueries', () => {
  test('returns non-empty set of queries', () => {
    const queries = createTestQueries();
    expect(queries.length).toBeGreaterThanOrEqual(5);
  });

  test('all queries have required fields', () => {
    const queries = createTestQueries();
    for (const q of queries) {
      expect(q.id).toBeDefined();
      expect(q.text.length).toBeGreaterThan(0);
      expect(q.expectedAnswer).toBeDefined();
      expect(q.expectedAnswer!.length).toBeGreaterThan(0);
      expect(q.category).toBeDefined();
    }
  });

  test('covers all query categories', () => {
    const queries = createTestQueries();
    const categories = new Set(queries.map((q) => q.category));
    expect(categories.has('single-hop')).toBe(true);
    expect(categories.has('multi-hop')).toBe(true);
    expect(categories.has('temporal')).toBe(true);
    expect(categories.has('comparative')).toBe(true);
    expect(categories.has('aggregation')).toBe(true);
  });

  test('each query references source document IDs', () => {
    const queries = createTestQueries();
    for (const q of queries) {
      const meta = q.metadata as { sourceDocIds: string[] };
      expect(meta.sourceDocIds.length).toBeGreaterThan(0);
    }
  });

  test('multi-hop queries reference multiple source documents', () => {
    const queries = createTestQueries();
    const multiHop = queries.filter((q) => q.category === 'multi-hop');
    for (const q of multiHop) {
      const meta = q.metadata as { sourceDocIds: string[] };
      expect(meta.sourceDocIds.length).toBeGreaterThanOrEqual(2);
    }
  });

  test('generates unique IDs across calls', () => {
    const queries1 = createTestQueries();
    const queries2 = createTestQueries();
    // UUIDs should be different between calls
    expect(queries1[0].id).not.toBe(queries2[0].id);
  });
});
