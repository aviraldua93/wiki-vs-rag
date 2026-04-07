/**
 * Unit tests for src/config.ts
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { loadConfig, resetConfig } from '../../src/config.ts';

describe('config', () => {
  beforeEach(() => {
    resetConfig();
  });

  test('loads defaults when no env vars set', () => {
    const config = loadConfig({});
    expect(config.openaiApiKey).toBe('');
    expect(config.ragA2aUrl).toBe('http://localhost:3737');
    expect(config.wikiDir).toBe('./wiki');
    expect(config.corpusDir).toBe('./corpus');
    expect(config.logLevel).toBe('info');
    expect(config.llmProvider).toBe('mock');
    expect(config.ragProvider).toBe('mock');
    expect(config.compileModel).toBe('gpt-4o-mini');
    expect(config.judgeModel).toBe('gpt-4o');
  });

  test('selects openai provider when OPENAI_API_KEY is set', () => {
    const config = loadConfig({ OPENAI_API_KEY: 'sk-test-key' });
    expect(config.llmProvider).toBe('openai');
    expect(config.openaiApiKey).toBe('sk-test-key');
  });

  test('respects explicit LLM_PROVIDER override', () => {
    const config = loadConfig({
      OPENAI_API_KEY: 'sk-test-key',
      LLM_PROVIDER: 'mock',
    });
    expect(config.llmProvider).toBe('mock');
  });

  test('respects explicit RAG_PROVIDER override', () => {
    const config = loadConfig({ RAG_PROVIDER: 'openai' });
    expect(config.ragProvider).toBe('openai');
  });

  test('falls back to mock for invalid provider string', () => {
    const config = loadConfig({ LLM_PROVIDER: 'invalid-provider' });
    expect(config.llmProvider).toBe('mock');
  });

  test('loads custom paths from env vars', () => {
    const config = loadConfig({
      WIKI_DIR: '/custom/wiki',
      CORPUS_DIR: '/custom/corpus',
      RAG_A2A_URL: 'http://my-rag:9999',
      LOG_LEVEL: 'debug',
      COMPILE_MODEL: 'gpt-4o',
      JUDGE_MODEL: 'gpt-4-turbo',
    });
    expect(config.wikiDir).toBe('/custom/wiki');
    expect(config.corpusDir).toBe('/custom/corpus');
    expect(config.ragA2aUrl).toBe('http://my-rag:9999');
    expect(config.logLevel).toBe('debug');
    expect(config.compileModel).toBe('gpt-4o');
    expect(config.judgeModel).toBe('gpt-4-turbo');
  });

  test('loadConfig is pure — does not mutate input env', () => {
    const env: Record<string, string | undefined> = { LOG_LEVEL: 'warn' };
    loadConfig(env);
    expect(Object.keys(env)).toEqual(['LOG_LEVEL']);
  });
});
