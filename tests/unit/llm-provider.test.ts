/**
 * Unit tests for src/providers/llm.ts (MockLLM and factory)
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { MockLLM, createLLMProvider } from '../../src/providers/llm.ts';
import type { ChatMessage } from '../../src/types.ts';
import { resetConfig } from '../../src/config.ts';

// Silence logger during tests
process.env.LOG_LEVEL = 'silent';

describe('MockLLM', () => {
  let llm: MockLLM;

  beforeEach(() => {
    resetConfig();
    llm = new MockLLM();
  });

  test('returns wiki page response for compile requests', async () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a wiki compiler.' },
      { role: 'user', content: 'Compile this document into a wiki page about testing.' },
    ];
    const result = await llm.complete(messages);
    expect(result.content).toContain('---');
    expect(result.content).toContain('title:');
    expect(result.content).toContain('type: source');
    expect(result.content).toContain('[[');
  });

  test('returns answer response for question requests', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'What is the answer to this question?' },
    ];
    const result = await llm.complete(messages);
    expect(result.content).toContain('answer');
    expect(result.content).toContain('[[Mock Source');
  });

  test('returns judge response for evaluation requests', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Please judge and evaluate the following answer.' },
    ];
    const result = await llm.complete(messages);
    const parsed = JSON.parse(result.content);
    expect(parsed.correctness).toBeGreaterThanOrEqual(0);
    expect(parsed.correctness).toBeLessThanOrEqual(1);
    expect(parsed.completeness).toBeDefined();
    expect(parsed.coherence).toBeDefined();
    expect(parsed.citationQuality).toBeDefined();
    expect(parsed.reasoning).toBeDefined();
  });

  test('returns lint response for lint requests', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Lint this wiki page and check for issues.' },
    ];
    const result = await llm.complete(messages);
    const parsed = JSON.parse(result.content);
    expect(parsed.issues).toBeInstanceOf(Array);
    expect(parsed.suggestions).toBeInstanceOf(Array);
    expect(parsed.score).toBeGreaterThan(0);
  });

  test('returns default response for unrecognized requests', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello world' },
    ];
    const result = await llm.complete(messages);
    expect(result.content).toContain('Mock LLM response for');
  });

  test('tracks token usage', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Test message for token tracking' },
    ];
    const result = await llm.complete(messages);
    expect(result.tokenUsage.promptTokens).toBeGreaterThan(0);
    expect(result.tokenUsage.completionTokens).toBeGreaterThan(0);
    expect(result.tokenUsage.totalTokens).toBe(
      result.tokenUsage.promptTokens + result.tokenUsage.completionTokens,
    );
  });

  test('uses default model name', async () => {
    const result = await llm.complete([{ role: 'user', content: 'test' }]);
    expect(result.model).toBe('mock-gpt-4o-mini');
  });

  test('respects custom model option', async () => {
    const result = await llm.complete(
      [{ role: 'user', content: 'test' }],
      { model: 'gpt-4o' },
    );
    expect(result.model).toBe('gpt-4o');
  });

  test('tracks call count', async () => {
    expect(llm.getCallCount()).toBe(0);
    await llm.complete([{ role: 'user', content: 'one' }]);
    expect(llm.getCallCount()).toBe(1);
    await llm.complete([{ role: 'user', content: 'two' }]);
    expect(llm.getCallCount()).toBe(2);
  });

  test('maintains call log', async () => {
    const msg: ChatMessage[] = [{ role: 'user', content: 'test message' }];
    await llm.complete(msg);
    const log = llm.getCallLog();
    expect(log.length).toBe(1);
    expect(log[0].messages).toEqual(msg);
    expect(log[0].response.length).toBeGreaterThan(0);
  });

  test('reset clears state', async () => {
    await llm.complete([{ role: 'user', content: 'before reset' }]);
    expect(llm.getCallCount()).toBe(1);
    llm.reset();
    expect(llm.getCallCount()).toBe(0);
    expect(llm.getCallLog()).toEqual([]);
  });

  test('always returns stop finish reason', async () => {
    const result = await llm.complete([{ role: 'user', content: 'test' }]);
    expect(result.finishReason).toBe('stop');
  });

  test('handles empty messages array', async () => {
    const result = await llm.complete([]);
    expect(result.content.length).toBeGreaterThan(0);
  });
});

describe('createLLMProvider factory', () => {
  test('creates MockLLM for mock provider', () => {
    const provider = createLLMProvider('mock');
    expect(provider.name).toBe('mock');
  });

  test('throws for openai provider without API key', () => {
    expect(() => createLLMProvider('openai')).toThrow('OPENAI_API_KEY');
  });

  test('creates OpenAI provider with API key', () => {
    const provider = createLLMProvider('openai', 'sk-test');
    expect(provider.name).toBe('openai');
  });

  test('throws for unknown provider', () => {
    expect(() => createLLMProvider('invalid' as any)).toThrow('Unknown LLM provider');
  });
});
