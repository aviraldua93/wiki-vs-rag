/**
 * Unit tests for src/providers/rag-client.ts (MockRAGClient and factory)
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { MockRAGClient, createRAGClient } from '../../src/providers/rag-client.ts';
import type { A2ATask } from '../../src/types.ts';
import { resetConfig } from '../../src/config.ts';

// Silence logger during tests
process.env.LOG_LEVEL = 'silent';

describe('MockRAGClient', () => {
  let client: MockRAGClient;

  beforeEach(() => {
    resetConfig();
    client = new MockRAGClient();
  });

  test('returns default mock response', async () => {
    const task: A2ATask = {
      id: 'test-1',
      message: 'What is Meridian?',
    };
    const result = await client.query(task);
    expect(result.taskId).toBe('test-1');
    expect(result.status).toBe('completed');
    expect(result.answer).toContain('mock RAG response');
    expect(result.citations.length).toBe(2);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('returns custom answer from responseMap', async () => {
    const customClient = new MockRAGClient({
      responseMap: {
        'meridian': 'Meridian is a data platform built by Dr. Sarah Chen.',
      },
    });
    const result = await customClient.query({
      id: 'q-1',
      message: 'What is Meridian Data Platform?',
    });
    expect(result.answer).toBe('Meridian is a data platform built by Dr. Sarah Chen.');
  });

  test('simulates latency when configured', async () => {
    const slowClient = new MockRAGClient({ latencyMs: 50 });
    const start = Date.now();
    await slowClient.query({ id: 't-1', message: 'test' });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45); // Allow small timing margin
  });

  test('simulates failures when shouldFail is true', async () => {
    const failClient = new MockRAGClient({ shouldFail: true });
    const result = await failClient.query({ id: 'f-1', message: 'will fail' });
    expect(result.status).toBe('failed');
    expect(result.answer).toBe('');
    expect(result.citations).toEqual([]);
  });

  test('healthCheck returns true by default', async () => {
    expect(await client.healthCheck()).toBe(true);
  });

  test('healthCheck returns false when unhealthy', async () => {
    const unhealthy = new MockRAGClient({ healthy: false });
    expect(await unhealthy.healthCheck()).toBe(false);
  });

  test('tracks call count', async () => {
    expect(client.getCallCount()).toBe(0);
    await client.query({ id: '1', message: 'q1' });
    await client.query({ id: '2', message: 'q2' });
    expect(client.getCallCount()).toBe(2);
  });

  test('maintains call log', async () => {
    const task: A2ATask = { id: 'log-1', message: 'logged query' };
    await client.query(task);
    const log = client.getCallLog();
    expect(log.length).toBe(1);
    expect(log[0].task.id).toBe('log-1');
    expect(log[0].result.status).toBe('completed');
  });

  test('reset clears state', async () => {
    await client.query({ id: '1', message: 'before reset' });
    expect(client.getCallCount()).toBe(1);
    client.reset();
    expect(client.getCallCount()).toBe(0);
    expect(client.getCallLog()).toEqual([]);
  });

  test('configure updates options at runtime', async () => {
    client.configure({ defaultAnswer: 'Updated answer' });
    const result = await client.query({ id: '1', message: 'test' });
    expect(result.answer).toBe('Updated answer');
  });

  test('includes token usage in response', async () => {
    const result = await client.query({ id: '1', message: 'test query' });
    expect(result.tokenUsage).toBeDefined();
    expect(result.tokenUsage!.promptTokens).toBeGreaterThan(0);
    expect(result.tokenUsage!.completionTokens).toBeGreaterThan(0);
    // totalTokens is estimated from combined text length, not sum of individual estimates
    expect(result.tokenUsage!.totalTokens).toBeGreaterThan(0);
  });

  test('citations include relevance scores', async () => {
    const result = await client.query({ id: '1', message: 'test' });
    for (const citation of result.citations) {
      expect(citation.source).toBeDefined();
      expect(citation.relevance).toBeGreaterThan(0);
      expect(citation.relevance).toBeLessThanOrEqual(1);
    }
  });

  test('handles metadata in task', async () => {
    const task: A2ATask = {
      id: 'meta-1',
      message: 'query with metadata',
      metadata: { category: 'multi-hop', difficulty: 'hard' },
    };
    const result = await client.query(task);
    expect(result.status).toBe('completed');
  });
});

describe('createRAGClient factory', () => {
  test('creates MockRAGClient for mock provider', () => {
    const client = createRAGClient('mock');
    expect(client.name).toBe('mock-rag');
  });

  test('creates A2ARAGClient for openai provider with URL', () => {
    const client = createRAGClient('openai', 'http://localhost:3737');
    expect(client.name).toBe('a2a-rag');
  });

  test('throws for openai provider without URL', () => {
    expect(() => createRAGClient('openai')).toThrow('RAG_A2A_URL');
  });

  test('throws for unknown provider', () => {
    expect(() => createRAGClient('invalid' as any)).toThrow('Unknown RAG provider');
  });

  test('passes mock options to MockRAGClient', async () => {
    const client = createRAGClient('mock', undefined, {
      defaultAnswer: 'Custom default',
    });
    const result = await (client as MockRAGClient).query({
      id: '1',
      message: 'test',
    });
    expect(result.answer).toBe('Custom default');
  });
});
