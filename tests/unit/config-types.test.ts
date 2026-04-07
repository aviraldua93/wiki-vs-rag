/**
 * Unit tests for shared types, config, and logger.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { loadConfig, resetConfig } from '../../src/config.ts';
import { createLogger, resetLogger } from '../../src/logger.ts';
import type {
  WikiPage,
  Query,
  Answer,
  BenchmarkResult,
  CorpusDocument,
  Citation,
  ChatMessage,
  LLMResponse,
  LLMProvider,
  RAGClient,
  TokenUsage,
  WikiPageType,
  QueryCategory,
  CorpusCategory,
  ProviderType,
  AppConfig,
} from '../../src/types.ts';

describe('Config', () => {
  beforeEach(() => {
    resetConfig();
    resetLogger();
  });

  it('loads default config when no env vars are set', () => {
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

  it('loads config from environment variables', () => {
    const config = loadConfig({
      OPENAI_API_KEY: 'sk-test-key',
      RAG_A2A_URL: 'http://rag:9999',
      WIKI_DIR: '/tmp/wiki',
      CORPUS_DIR: '/tmp/corpus',
      LOG_LEVEL: 'debug',
      LLM_PROVIDER: 'openai',
      RAG_PROVIDER: 'mock',
      COMPILE_MODEL: 'gpt-4-turbo',
      JUDGE_MODEL: 'gpt-4-turbo',
    });
    expect(config.openaiApiKey).toBe('sk-test-key');
    expect(config.ragA2aUrl).toBe('http://rag:9999');
    expect(config.wikiDir).toBe('/tmp/wiki');
    expect(config.corpusDir).toBe('/tmp/corpus');
    expect(config.logLevel).toBe('debug');
    expect(config.llmProvider).toBe('openai');
    expect(config.ragProvider).toBe('mock');
    expect(config.compileModel).toBe('gpt-4-turbo');
    expect(config.judgeModel).toBe('gpt-4-turbo');
  });

  it('auto-selects mock provider when no API key is set', () => {
    const config = loadConfig({});
    expect(config.llmProvider).toBe('mock');
  });

  it('auto-selects openai provider when API key is present', () => {
    const config = loadConfig({ OPENAI_API_KEY: 'sk-some-key' });
    expect(config.llmProvider).toBe('openai');
  });

  it('respects explicit LLM_PROVIDER even without API key', () => {
    const config = loadConfig({ LLM_PROVIDER: 'openai' });
    expect(config.llmProvider).toBe('openai');
  });
});

describe('Types', () => {
  it('WikiPage type is constructible with all fields', () => {
    const page: WikiPage = {
      title: 'Test Page',
      type: 'source',
      tags: ['test', 'unit'],
      sources: ['corpus/technical/api.md'],
      content: 'This is a test page with [[WikiLink]].',
      wikilinks: ['WikiLink'],
      created: '2025-01-01',
      updated: '2025-01-02',
      filePath: 'sources/test-page.md',
    };
    expect(page.title).toBe('Test Page');
    expect(page.type).toBe('source');
    expect(page.wikilinks).toContain('WikiLink');
  });

  it('Query type is constructible', () => {
    const query: Query = {
      id: 'q-001',
      text: 'What is the capital of France?',
      expectedAnswer: 'Paris',
      category: 'single-hop',
    };
    expect(query.id).toBe('q-001');
    expect(query.category).toBe('single-hop');
  });

  it('Answer type includes citations', () => {
    const answer: Answer = {
      queryId: 'q-001',
      text: 'Paris is the capital of France.',
      citations: [
        { source: 'geography.md', excerpt: 'Paris is the capital', relevance: 0.95 },
      ],
      system: 'wiki',
      latencyMs: 150,
      costUsd: 0.001,
      tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    };
    expect(answer.citations).toHaveLength(1);
    expect(answer.system).toBe('wiki');
  });

  it('BenchmarkResult connects query to both answers', () => {
    const result: BenchmarkResult = {
      query: { id: 'q-001', text: 'test question' },
      wikiAnswer: {
        queryId: 'q-001',
        text: 'wiki answer',
        citations: [],
        system: 'wiki',
        latencyMs: 100,
      },
      ragAnswer: {
        queryId: 'q-001',
        text: 'rag answer',
        citations: [],
        system: 'rag',
        latencyMs: 200,
      },
      winner: 'wiki',
      timestamp: new Date().toISOString(),
    };
    expect(result.winner).toBe('wiki');
    expect(result.wikiAnswer.system).toBe('wiki');
    expect(result.ragAnswer.system).toBe('rag');
  });

  it('CorpusDocument includes category and metadata', () => {
    const doc: CorpusDocument = {
      id: 'technical-api-design',
      title: 'API Design',
      content: '# API Design\nREST best practices...',
      filePath: '/corpus/technical/api-design.md',
      relativePath: 'technical/api-design.md',
      category: 'technical',
      metadata: { author: 'test' },
      sizeBytes: 1024,
    };
    expect(doc.category).toBe('technical');
    expect(doc.id).toBe('technical-api-design');
  });

  it('all WikiPageType values are valid', () => {
    const types: WikiPageType[] = ['source', 'entity', 'concept', 'synthesis'];
    expect(types).toHaveLength(4);
  });

  it('all CorpusCategory values are valid', () => {
    const cats: CorpusCategory[] = ['technical', 'narrative', 'multi-doc', 'evolving'];
    expect(cats).toHaveLength(4);
  });

  it('all QueryCategory values are valid', () => {
    const cats: QueryCategory[] = ['single-hop', 'multi-hop', 'temporal', 'comparative', 'aggregation'];
    expect(cats).toHaveLength(5);
  });
});

describe('Logger', () => {
  beforeEach(() => {
    resetConfig();
    resetLogger();
  });

  it('creates a child logger with module context', () => {
    const log = createLogger('test-module');
    expect(log).toBeDefined();
    expect(typeof log.info).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.debug).toBe('function');
  });

  it('creates a child logger with additional bindings', () => {
    const log = createLogger('wiki-agent', { runId: 'run-123' });
    expect(log).toBeDefined();
    expect(typeof log.info).toBe('function');
  });

  it('multiple child loggers share the same root', () => {
    const log1 = createLogger('module-a');
    const log2 = createLogger('module-b');
    expect(log1).toBeDefined();
    expect(log2).toBeDefined();
    // Both are functional
    expect(typeof log1.info).toBe('function');
    expect(typeof log2.info).toBe('function');
  });
});
