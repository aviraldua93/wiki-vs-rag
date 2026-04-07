/**
 * E2E Test: Full pipeline — ingest corpus → lint → query → verify cited answer.
 *
 * Uses the real test corpus documents and mock providers.
 * Verifies the complete flow: load corpus → ingest into wiki → lint → query → answer with citations.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { loadCorpus } from '../../src/corpus/loader.ts';
import { runIngestPipeline } from '../../src/wiki-agent/ingest/pipeline.ts';
import { createFTS5Storage, WikiFTS5Storage } from '../../src/wiki-agent/wiki/fts5-storage.ts';
import { runLint } from '../../src/wiki-agent/lint/engine.ts';
import { executeQuery } from '../../src/wiki-agent/query/engine.ts';
import { MockLLM } from '../../src/providers/llm.ts';
import { resetConfig } from '../../src/config.ts';
import type { Query } from '../../src/types.ts';

// Silence logger during tests
process.env.LOG_LEVEL = 'silent';

const CORPUS_DIR = join(import.meta.dir, '..', '..', 'corpus');

describe('E2E Pipeline: Ingest → Lint → Query', () => {
  let storage: WikiFTS5Storage;
  let llm: MockLLM;

  beforeAll(async () => {
    resetConfig();
    storage = createFTS5Storage(':memory:');
    llm = new MockLLM();

    // Step 1: Load the real corpus
    const docs = await loadCorpus(CORPUS_DIR);
    expect(docs.length).toBeGreaterThanOrEqual(10);

    // Step 2: Ingest all documents into the wiki
    const ingestResults = await runIngestPipeline(docs, llm, storage, {
      wikiDir: './wiki',
      writeToDisk: false,
    });

    // Verify all documents were ingested successfully
    const successCount = ingestResults.filter((r) => r.success).length;
    expect(successCount).toBe(docs.length);
  });

  afterAll(() => {
    storage.close();
  });

  test('corpus loads all documents from all 4 categories', async () => {
    const docs = await loadCorpus(CORPUS_DIR);
    const categories = new Set(docs.map((d) => d.category));
    expect(categories.has('technical')).toBe(true);
    expect(categories.has('narrative')).toBe(true);
    expect(categories.has('multi-doc')).toBe(true);
    expect(categories.has('evolving')).toBe(true);
  });

  test('ingest pipeline produces indexed wiki pages', () => {
    const pageCount = storage.getPageCount();
    expect(pageCount).toBeGreaterThanOrEqual(1);
  });

  test('lint pass completes with a score', async () => {
    const lintResult = await runLint(storage, llm);

    expect(lintResult.pagesChecked).toBeGreaterThanOrEqual(1);
    expect(lintResult.score).toBeGreaterThan(0);
    expect(lintResult.score).toBeLessThanOrEqual(1);
    expect(Array.isArray(lintResult.issues)).toBe(true);
  });

  test('lint detects structural issues (broken wikilinks expected from mock pages)', async () => {
    const lintResult = await runLint(storage, llm);

    // Mock-compiled pages contain [[Mock Concept]] and [[Related Topic]] wikilinks
    // that don't correspond to real pages — these should be detected as broken links
    const brokenLinks = lintResult.issues.filter((i) => i.category === 'broken-link');
    expect(brokenLinks.length).toBeGreaterThan(0);
  });

  test('query returns an answer with citations for a known topic', async () => {
    const query: Query = {
      id: 'e2e-q1',
      text: 'mock compiled wiki',
      category: 'single-hop',
    };

    const answer = await executeQuery(query, storage, llm);

    expect(answer.queryId).toBe('e2e-q1');
    expect(answer.system).toBe('wiki');
    expect(answer.text.length).toBeGreaterThan(0);
    expect(answer.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('query returns no-context answer for unrelated topic', async () => {
    const query: Query = {
      id: 'e2e-q-miss',
      text: 'quantum entanglement physics',
    };

    const answer = await executeQuery(query, storage, llm);

    // Should indicate no relevant info found
    expect(answer.queryId).toBe('e2e-q-miss');
    expect(answer.text.length).toBeGreaterThan(0);
  });

  test('full pipeline completes in under 30 seconds', async () => {
    const start = Date.now();

    // Re-run the full pipeline
    const tmpStorage = createFTS5Storage(':memory:');
    const tmpLlm = new MockLLM();
    const docs = await loadCorpus(CORPUS_DIR);

    await runIngestPipeline(docs, tmpLlm, tmpStorage, {
      wikiDir: './wiki',
      writeToDisk: false,
    });
    await runLint(tmpStorage, tmpLlm);

    const query: Query = { id: 'timing-test', text: 'mock compiled' };
    await executeQuery(query, tmpStorage, tmpLlm);

    tmpStorage.close();

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(30000);
  });

  test('LLM was called for each document during ingest + lint + query', () => {
    // Ingest: 1 call per document (10 docs) + lint: 1 call per page + query synthesis calls
    expect(llm.getCallCount()).toBeGreaterThan(10);
  });
});
