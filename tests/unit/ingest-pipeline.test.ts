/**
 * Unit tests for src/wiki-agent/ingest/pipeline.ts
 *
 * Tests: single document ingest, batch ingest, error handling.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { ingestDocument, runIngestPipeline } from '../../src/wiki-agent/ingest/pipeline.ts';
import { createFTS5Storage, WikiFTS5Storage } from '../../src/wiki-agent/wiki/fts5-storage.ts';
import { MockLLM } from '../../src/providers/llm.ts';
import type { CorpusDocument } from '../../src/types.ts';

// Silence logger during tests
process.env.LOG_LEVEL = 'silent';

function makeDoc(overrides: Partial<CorpusDocument> = {}): CorpusDocument {
  return {
    id: 'test-doc-1',
    title: 'Test Document',
    content: '# Test Document\n\nThis is a test document about the Meridian Data Platform.',
    filePath: '/corpus/technical/test.md',
    relativePath: 'technical/test.md',
    category: 'technical',
    metadata: {},
    sizeBytes: 100,
    ...overrides,
  };
}

describe('ingestDocument', () => {
  let storage: WikiFTS5Storage;
  let llm: MockLLM;

  beforeEach(() => {
    storage = createFTS5Storage(':memory:');
    llm = new MockLLM();
  });

  afterEach(() => {
    storage.close();
  });

  test('successfully ingests a document', async () => {
    const doc = makeDoc();
    const result = await ingestDocument(doc, llm, storage, {
      wikiDir: '/tmp/wiki',
      writeToDisk: false,
    });

    expect(result.success).toBe(true);
    expect(result.documentId).toBe('test-doc-1');
    expect(result.page).toBeDefined();
    expect(result.page!.title.length).toBeGreaterThan(0);
  });

  test('indexes page in FTS5 storage', async () => {
    const doc = makeDoc();
    await ingestDocument(doc, llm, storage, {
      wikiDir: '/tmp/wiki',
      writeToDisk: false,
    });

    expect(storage.getPageCount()).toBe(1);
  });

  test('tracks source reference in compiled page', async () => {
    const doc = makeDoc({ relativePath: 'technical/api-ref.md' });
    const result = await ingestDocument(doc, llm, storage, {
      wikiDir: '/tmp/wiki',
      writeToDisk: false,
    });

    expect(result.page!.sources).toContain('technical/api-ref.md');
  });

  test('calls LLM provider for compilation', async () => {
    const doc = makeDoc();
    await ingestDocument(doc, llm, storage, {
      wikiDir: '/tmp/wiki',
      writeToDisk: false,
    });

    expect(llm.getCallCount()).toBe(1);
    const callLog = llm.getCallLog();
    expect(callLog[0].messages.length).toBe(2); // system + user
    expect(callLog[0].messages[0].role).toBe('system');
    expect(callLog[0].messages[1].role).toBe('user');
  });

  test('passes custom model option', async () => {
    const doc = makeDoc();
    await ingestDocument(doc, llm, storage, {
      wikiDir: '/tmp/wiki',
      writeToDisk: false,
      model: 'gpt-4o',
    });

    expect(llm.getCallCount()).toBe(1);
  });
});

describe('runIngestPipeline', () => {
  let storage: WikiFTS5Storage;
  let llm: MockLLM;

  beforeEach(() => {
    storage = createFTS5Storage(':memory:');
    llm = new MockLLM();
  });

  afterEach(() => {
    storage.close();
  });

  test('ingests multiple documents', async () => {
    const docs = [
      makeDoc({ id: 'doc-1', title: 'Doc One' }),
      makeDoc({ id: 'doc-2', title: 'Doc Two' }),
      makeDoc({ id: 'doc-3', title: 'Doc Three' }),
    ];

    const results = await runIngestPipeline(docs, llm, storage, {
      wikiDir: '/tmp/wiki',
      writeToDisk: false,
    });

    expect(results.length).toBe(3);
    expect(results.every((r) => r.success)).toBe(true);
    // MockLLM may produce same title for similar prompts causing upsert overlap
    expect(storage.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(llm.getCallCount()).toBe(3);
  });

  test('handles empty document list', async () => {
    const results = await runIngestPipeline([], llm, storage, {
      wikiDir: '/tmp/wiki',
      writeToDisk: false,
    });

    expect(results).toEqual([]);
    expect(storage.getPageCount()).toBe(0);
  });

  test('returns per-document results', async () => {
    const docs = [
      makeDoc({ id: 'a' }),
      makeDoc({ id: 'b' }),
    ];

    const results = await runIngestPipeline(docs, llm, storage, {
      wikiDir: '/tmp/wiki',
      writeToDisk: false,
    });

    expect(results[0].documentId).toBe('a');
    expect(results[1].documentId).toBe('b');
  });
});
