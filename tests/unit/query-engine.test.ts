/**
 * Unit tests for src/wiki-agent/query/engine.ts
 *
 * Tests: query execution, citation extraction, no-context handling.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { executeQuery } from '../../src/wiki-agent/query/engine.ts';
import { createFTS5Storage, WikiFTS5Storage } from '../../src/wiki-agent/wiki/fts5-storage.ts';
import { MockLLM } from '../../src/providers/llm.ts';
import type { Query, WikiPage } from '../../src/types.ts';

// Silence logger during tests
process.env.LOG_LEVEL = 'silent';

function makePage(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    title: 'Test Page',
    type: 'source',
    tags: ['test'],
    sources: ['test.md'],
    content: 'This is content about the Meridian Data Platform and its API.',
    wikilinks: [],
    created: '2025-01-01',
    updated: '2025-01-01',
    ...overrides,
  };
}

describe('executeQuery', () => {
  let storage: WikiFTS5Storage;
  let llm: MockLLM;

  beforeEach(() => {
    storage = createFTS5Storage(':memory:');
    llm = new MockLLM();
  });

  afterEach(() => {
    storage.close();
  });

  test('returns answer for matching query', async () => {
    storage.upsertPages([
      makePage({ title: 'API Reference', content: 'The Meridian API supports REST endpoints.' }),
      makePage({ title: 'System Architecture', content: 'Architecture uses Kafka and PostgreSQL.' }),
    ]);

    const query: Query = {
      id: 'q-1',
      text: 'What does the Meridian API support?',
      category: 'single-hop',
    };

    const answer = await executeQuery(query, storage, llm);
    expect(answer.queryId).toBe('q-1');
    expect(answer.system).toBe('wiki');
    expect(answer.text.length).toBeGreaterThan(0);
    expect(answer.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('returns no-context answer when nothing matches', async () => {
    // Storage is empty
    const query: Query = {
      id: 'q-empty',
      text: 'What is quantum entanglement?',
    };

    const answer = await executeQuery(query, storage, llm);
    expect(answer.queryId).toBe('q-empty');
    expect(answer.text).toContain('could not find');
    expect(answer.citations).toEqual([]);
  });

  test('uses LLM for synthesis when context found', async () => {
    storage.upsertPages([
      makePage({ title: 'Meridian Overview', content: 'Meridian processes 2.3 billion events daily across all clusters.' }),
    ]);

    const query: Query = {
      id: 'q-2',
      text: 'Meridian events',
    };

    await executeQuery(query, storage, llm);
    expect(llm.getCallCount()).toBe(1);
  });

  test('does not call LLM when no context found', async () => {
    const query: Query = {
      id: 'q-no-ctx',
      text: 'Completely unrelated topic',
    };

    await executeQuery(query, storage, llm);
    expect(llm.getCallCount()).toBe(0);
  });

  test('includes citations from answer text', async () => {
    storage.upsertPages([
      makePage({ title: 'Mock Source 1', content: 'API design patterns and best practices for REST services.' }),
      makePage({ title: 'Mock Source 2', content: 'API endpoint configuration and rate limiting for REST.' }),
    ]);

    const query: Query = {
      id: 'q-cite',
      text: 'API REST',
    };

    const answer = await executeQuery(query, storage, llm);
    // MockLLM includes [[Mock Source 1]] and [[Mock Source 2]] in answers
    expect(answer.citations.length).toBeGreaterThan(0);
  });

  test('includes token usage in answer', async () => {
    storage.upsertPages([
      makePage({ title: 'Usage Test', content: 'Meridian platform overview and capabilities.' }),
    ]);

    const query: Query = {
      id: 'q-tokens',
      text: 'Meridian platform',
    };

    const answer = await executeQuery(query, storage, llm);
    expect(answer.tokenUsage).toBeDefined();
    expect(answer.tokenUsage!.totalTokens).toBeGreaterThan(0);
  });

  test('respects maxPages option', async () => {
    // Add many pages
    const pages = Array.from({ length: 10 }, (_, i) =>
      makePage({ title: `Meridian Page ${i}`, content: `Content about Meridian feature ${i} platform system.` }),
    );
    storage.upsertPages(pages);

    const query: Query = {
      id: 'q-limit',
      text: 'Meridian platform',
    };

    await executeQuery(query, storage, llm, { maxPages: 2 });
    // Verify LLM was called (meaning some pages were found and passed to it)
    expect(llm.getCallCount()).toBe(1);
  });

  test('handles concurrent queries', async () => {
    storage.upsertPages([
      makePage({ title: 'Concurrent Test', content: 'Concurrent testing with Meridian platform.' }),
    ]);

    const queries = Array.from({ length: 5 }, (_, i) => ({
      id: `q-concurrent-${i}`,
      text: 'Meridian platform',
    }));

    const answers = await Promise.all(
      queries.map((q) => executeQuery(q, storage, llm)),
    );

    expect(answers.length).toBe(5);
    for (const answer of answers) {
      expect(answer.system).toBe('wiki');
      expect(answer.text.length).toBeGreaterThan(0);
    }
  });
});
