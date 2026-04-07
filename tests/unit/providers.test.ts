/**
 * Unit tests for MockLLM and MockRAGClient providers.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { MockLLM, createLLMProvider } from '../../src/providers/llm.ts';
import {
  MockRAGClient,
  createRAGClient,
} from '../../src/providers/rag-client.ts';
import { resetConfig } from '../../src/config.ts';
import { resetLogger } from '../../src/logger.ts';
import type { ChatMessage, A2ATask } from '../../src/types.ts';

describe('MockLLM', () => {
  let mock: MockLLM;

  beforeEach(() => {
    resetConfig();
    resetLogger();
    mock = new MockLLM();
  });

  it('has the name "mock"', () => {
    expect(mock.name).toBe('mock');
  });

  it('returns a response for any input', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello, world!' },
    ];
    const result = await mock.complete(messages);
    expect(result.content).toBeTruthy();
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.finishReason).toBe('stop');
    expect(result.model).toBe('mock-gpt-4o-mini');
  });

  it('returns deterministic outputs for the same input', async () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'What is 2 + 2? Please answer the question.' },
    ];

    const result1 = await mock.complete(messages);
    const result2 = await mock.complete(messages);

    expect(result1.content).toBe(result2.content);
    expect(result1.model).toBe(result2.model);
  });

  it('matches compile pattern and returns wiki page', async () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Compile this document into a wiki page.' },
      { role: 'user', content: 'API Design Best Practices' },
    ];

    const result = await mock.complete(messages);
    expect(result.content).toContain('---');
    expect(result.content).toContain('title:');
    expect(result.content).toContain('type: source');
    expect(result.content).toContain('[[');
  });

  it('matches judge pattern and returns scores JSON', async () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Evaluate and judge the following answer.' },
      { role: 'user', content: 'Answer: Paris is the capital of France.' },
    ];

    const result = await mock.complete(messages);
    const parsed = JSON.parse(result.content);
    expect(parsed.correctness).toBeGreaterThanOrEqual(0);
    expect(parsed.correctness).toBeLessThanOrEqual(1);
    expect(parsed.completeness).toBeGreaterThanOrEqual(0);
    expect(parsed.coherence).toBeGreaterThanOrEqual(0);
    expect(parsed.citationQuality).toBeGreaterThanOrEqual(0);
    expect(parsed.reasoning).toBeTruthy();
  });

  it('matches question-answering pattern', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Answer the following question: What is TypeScript?' },
    ];

    const result = await mock.complete(messages);
    expect(result.content).toContain('mock answer');
    expect(result.content).toContain('[[Mock Source');
  });

  it('matches lint pattern and returns issues JSON', async () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Check and lint this wiki page for issues.' },
      { role: 'user', content: '# Some Page\nContent here.' },
    ];

    const result = await mock.complete(messages);
    const parsed = JSON.parse(result.content);
    expect(Array.isArray(parsed.issues)).toBe(true);
    expect(parsed.score).toBeGreaterThanOrEqual(0);
  });

  it('tracks call count accurately', async () => {
    expect(mock.getCallCount()).toBe(0);

    await mock.complete([{ role: 'user', content: 'Test 1' }]);
    expect(mock.getCallCount()).toBe(1);

    await mock.complete([{ role: 'user', content: 'Test 2' }]);
    expect(mock.getCallCount()).toBe(2);
  });

  it('tracks call log with messages and responses', async () => {
    await mock.complete([{ role: 'user', content: 'First call' }]);
    await mock.complete([{ role: 'user', content: 'Second call' }]);

    const log = mock.getCallLog();
    expect(log).toHaveLength(2);
    expect(log[0].messages[0].content).toBe('First call');
    expect(log[1].messages[0].content).toBe('Second call');
  });

  it('reset clears state', async () => {
    await mock.complete([{ role: 'user', content: 'Test' }]);
    expect(mock.getCallCount()).toBe(1);

    mock.reset();
    expect(mock.getCallCount()).toBe(0);
    expect(mock.getCallLog()).toHaveLength(0);
  });

  it('includes token usage in response', async () => {
    const result = await mock.complete([
      { role: 'user', content: 'Hello' },
    ]);
    expect(result.tokenUsage.promptTokens).toBeGreaterThan(0);
    expect(result.tokenUsage.completionTokens).toBeGreaterThan(0);
    expect(result.tokenUsage.totalTokens).toBe(
      result.tokenUsage.promptTokens + result.tokenUsage.completionTokens,
    );
  });

  it('respects model option', async () => {
    const result = await mock.complete(
      [{ role: 'user', content: 'Test' }],
      { model: 'gpt-4-turbo' },
    );
    expect(result.model).toBe('gpt-4-turbo');
  });
});

describe('MockRAGClient', () => {
  let mock: MockRAGClient;

  beforeEach(() => {
    resetConfig();
    resetLogger();
    mock = new MockRAGClient();
  });

  it('has the name "mock-rag"', () => {
    expect(mock.name).toBe('mock-rag');
  });

  it('returns a completed result for any query', async () => {
    const task: A2ATask = {
      id: 'task-001',
      message: 'What is TypeScript?',
    };

    const result = await mock.query(task);
    expect(result.taskId).toBe('task-001');
    expect(result.status).toBe('completed');
    expect(result.answer).toBeTruthy();
    expect(result.citations).toHaveLength(2);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns deterministic outputs for the same input', async () => {
    const task: A2ATask = {
      id: 'task-001',
      message: 'What is TypeScript?',
    };

    const result1 = await mock.query(task);
    const result2 = await mock.query(task);

    expect(result1.answer).toBe(result2.answer);
    expect(result1.status).toBe(result2.status);
    expect(result1.citations.length).toBe(result2.citations.length);
  });

  it('uses custom response map when pattern matches', async () => {
    const custom = new MockRAGClient({
      responseMap: {
        'typescript': 'TypeScript is a typed superset of JavaScript.',
        'python': 'Python is a dynamic programming language.',
      },
    });

    const tsResult = await custom.query({
      id: 't1',
      message: 'Tell me about TypeScript please',
    });
    expect(tsResult.answer).toBe('TypeScript is a typed superset of JavaScript.');

    const pyResult = await custom.query({
      id: 't2',
      message: 'What is Python?',
    });
    expect(pyResult.answer).toBe('Python is a dynamic programming language.');
  });

  it('falls back to default answer when no pattern matches', async () => {
    const custom = new MockRAGClient({
      defaultAnswer: 'Custom default answer.',
      responseMap: { 'xyz': 'matched xyz' },
    });

    const result = await custom.query({
      id: 't1',
      message: 'Some unrelated query',
    });
    expect(result.answer).toBe('Custom default answer.');
  });

  it('simulates latency when configured', async () => {
    const slow = new MockRAGClient({ latencyMs: 50 });
    const start = Date.now();
    await slow.query({ id: 't1', message: 'Test' });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40); // Allow slight timing variance
  });

  it('simulates failure when configured', async () => {
    const failing = new MockRAGClient({ shouldFail: true });
    const result = await failing.query({
      id: 'fail-1',
      message: 'This should fail',
    });
    expect(result.status).toBe('failed');
    expect(result.answer).toBe('');
  });

  it('healthCheck returns configured status', async () => {
    const healthy = new MockRAGClient({ healthy: true });
    expect(await healthy.healthCheck()).toBe(true);

    const unhealthy = new MockRAGClient({ healthy: false });
    expect(await unhealthy.healthCheck()).toBe(false);
  });

  it('tracks call count and log', async () => {
    expect(mock.getCallCount()).toBe(0);

    await mock.query({ id: 't1', message: 'First' });
    await mock.query({ id: 't2', message: 'Second' });

    expect(mock.getCallCount()).toBe(2);
    const log = mock.getCallLog();
    expect(log).toHaveLength(2);
    expect(log[0].task.id).toBe('t1');
    expect(log[1].task.id).toBe('t2');
  });

  it('reset clears state', async () => {
    await mock.query({ id: 't1', message: 'Test' });
    mock.reset();
    expect(mock.getCallCount()).toBe(0);
    expect(mock.getCallLog()).toHaveLength(0);
  });

  it('configure updates options at runtime', async () => {
    mock.configure({ defaultAnswer: 'Updated answer!' });
    const result = await mock.query({ id: 't1', message: 'Test' });
    expect(result.answer).toBe('Updated answer!');
  });

  it('includes token usage in result', async () => {
    const result = await mock.query({
      id: 't1',
      message: 'What is the meaning of life?',
    });
    expect(result.tokenUsage).toBeDefined();
    expect(result.tokenUsage!.promptTokens).toBeGreaterThan(0);
    expect(result.tokenUsage!.completionTokens).toBeGreaterThan(0);
    expect(result.tokenUsage!.totalTokens).toBe(
      result.tokenUsage!.promptTokens + result.tokenUsage!.completionTokens,
    );
  });
});

describe('Provider Factories', () => {
  beforeEach(() => {
    resetConfig();
    resetLogger();
  });

  it('createLLMProvider("mock") returns MockLLM', () => {
    const provider = createLLMProvider('mock');
    expect(provider.name).toBe('mock');
    expect(provider).toBeInstanceOf(MockLLM);
  });

  it('createLLMProvider("openai") throws without API key', () => {
    expect(() => createLLMProvider('openai')).toThrow('OPENAI_API_KEY');
  });

  it('createLLMProvider("openai", key) returns OpenAILLM', () => {
    const provider = createLLMProvider('openai', 'sk-test-key');
    expect(provider.name).toBe('openai');
  });

  it('createRAGClient("mock") returns MockRAGClient', () => {
    const client = createRAGClient('mock');
    expect(client.name).toBe('mock-rag');
    expect(client).toBeInstanceOf(MockRAGClient);
  });

  it('createRAGClient("openai") throws without URL', () => {
    expect(() => createRAGClient('openai')).toThrow('RAG_A2A_URL');
  });

  it('createRAGClient("openai", url) returns A2ARAGClient', () => {
    const client = createRAGClient('openai', 'http://localhost:3737');
    expect(client.name).toBe('a2a-rag');
  });
});
