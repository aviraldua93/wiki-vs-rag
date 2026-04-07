/**
 * Unit tests for the enhanced ingest pipeline with entity/concept extraction.
 *
 * Tests: sub-page extraction, wikilink generation, full frontmatter validation.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { ingestDocument, runIngestPipeline } from '../../src/wiki-agent/ingest/pipeline.ts';
import { createFTS5Storage, WikiFTS5Storage } from '../../src/wiki-agent/wiki/fts5-storage.ts';
import { MockLLM } from '../../src/providers/llm.ts';
import { extractWikilinks, validateWikiPage } from '../../src/wiki-agent/wiki/page.ts';
import type { CorpusDocument, WikiPage, ChatMessage, LLMResponse } from '../../src/types.ts';

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

describe('Ingest pipeline — wiki page quality', () => {
  let storage: WikiFTS5Storage;
  let llm: MockLLM;

  beforeEach(() => {
    storage = createFTS5Storage(':memory:');
    llm = new MockLLM();
  });

  afterEach(() => {
    storage.close();
  });

  test('compiled page has valid YAML frontmatter fields', async () => {
    const doc = makeDoc();
    const result = await ingestDocument(doc, llm, storage, {
      wikiDir: '/tmp/wiki',
      writeToDisk: false,
    });

    const page = result.page!;
    expect(page.title).toBeDefined();
    expect(page.title.length).toBeGreaterThan(0);
    expect(['source', 'entity', 'concept', 'synthesis']).toContain(page.type);
    expect(Array.isArray(page.tags)).toBe(true);
    expect(Array.isArray(page.sources)).toBe(true);
    expect(page.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(page.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('compiled page contains [[wikilinks]]', async () => {
    const doc = makeDoc();
    const result = await ingestDocument(doc, llm, storage, {
      wikiDir: '/tmp/wiki',
      writeToDisk: false,
    });

    const page = result.page!;
    // MockLLM always includes [[Mock Concept]] and [[Related Topic]] etc
    expect(page.wikilinks.length).toBeGreaterThan(0);
    // Verify wikilinks are extracted from content correctly
    const extractedLinks = extractWikilinks(page.content);
    expect(extractedLinks.length).toBeGreaterThan(0);
  });

  test('compiled page passes structural validation', async () => {
    const doc = makeDoc();
    const result = await ingestDocument(doc, llm, storage, {
      wikiDir: '/tmp/wiki',
      writeToDisk: false,
    });

    const errors = validateWikiPage(result.page!);
    // Should have no critical structural errors
    const criticalErrors = errors.filter(
      (e) => !e.includes('self-referential'),
    );
    expect(criticalErrors.length).toBe(0);
  });

  test('compiled page tracks source document in sources array', async () => {
    const doc = makeDoc({ relativePath: 'technical/api-reference.md' });
    const result = await ingestDocument(doc, llm, storage, {
      wikiDir: '/tmp/wiki',
      writeToDisk: false,
    });

    expect(result.page!.sources).toContain('technical/api-reference.md');
  });

  test('compiled page has Obsidian-compatible wikilinks', async () => {
    const doc = makeDoc();
    const result = await ingestDocument(doc, llm, storage, {
      wikiDir: '/tmp/wiki',
      writeToDisk: false,
    });

    // [[WikiLinks]] use double brackets, no namespace prefix
    const content = result.page!.content;
    const regex = /\[\[([^\]]+)\]\]/g;
    const matches: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      matches.push(match[1]);
    }
    // Each match should be a plain title (Obsidian-compatible)
    for (const m of matches) {
      expect(m).not.toContain('/'); // No path separators
      expect(m).not.toContain('\\');
      expect(m.trim()).toBe(m); // No leading/trailing whitespace
    }
  });

  test('batch pipeline produces consistent results', async () => {
    const docs = [
      makeDoc({ id: 'doc-a', title: 'Document Alpha', relativePath: 'technical/alpha.md' }),
      makeDoc({ id: 'doc-b', title: 'Document Beta', relativePath: 'narrative/beta.md', category: 'narrative' }),
    ];

    const results = await runIngestPipeline(docs, llm, storage, {
      wikiDir: '/tmp/wiki',
      writeToDisk: false,
    });

    expect(results.length).toBe(2);
    expect(results.every((r) => r.success)).toBe(true);
    expect(results[0].page!.sources).toContain('technical/alpha.md');
    expect(results[1].page!.sources).toContain('narrative/beta.md');
  });

  test('file paths are set correctly for source pages', async () => {
    const doc = makeDoc({ id: 'my-test-doc' });
    const result = await ingestDocument(doc, llm, storage, {
      wikiDir: '/tmp/wiki',
      writeToDisk: false,
    });

    expect(result.page!.filePath).toBe('sources/my-test-doc.md');
  });
});

describe('Ingest pipeline — entity/concept sub-page extraction', () => {
  let storage: WikiFTS5Storage;

  afterEach(() => {
    storage.close();
  });

  test('extracts entity and concept sub-pages when enabled', async () => {
    // Create a custom MockLLM that returns extraction JSON
    const customLlm = new (class extends MockLLM {
      private callIdx = 0;
      async complete(messages: ChatMessage[], options?: any): Promise<LLMResponse> {
        this.callIdx++;
        // First call = compile, second call = extract
        if (this.callIdx === 2) {
          return {
            content: JSON.stringify({
              entities: [
                { name: 'Meridian', type: 'project', description: 'A data platform for analytics.' },
              ],
              concepts: [
                { name: 'Data Pipeline', description: 'Automated data processing workflow.' },
              ],
            }),
            tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
            model: 'mock',
            finishReason: 'stop',
          };
        }
        return super.complete(messages, options);
      }
    })();

    storage = createFTS5Storage(':memory:');
    const doc = makeDoc();
    const result = await ingestDocument(doc, customLlm, storage, {
      wikiDir: '/tmp/wiki',
      writeToDisk: false,
      extractSubPages: true,
    });

    expect(result.success).toBe(true);
    expect(result.subPages).toBeDefined();
    expect(result.subPages!.length).toBe(2);

    const entityPage = result.subPages!.find((p) => p.type === 'entity');
    expect(entityPage).toBeDefined();
    expect(entityPage!.title).toBe('Meridian');
    expect(entityPage!.filePath).toBe('entities/meridian.md');

    const conceptPage = result.subPages!.find((p) => p.type === 'concept');
    expect(conceptPage).toBeDefined();
    expect(conceptPage!.title).toBe('Data Pipeline');
    expect(conceptPage!.filePath).toBe('concepts/data-pipeline.md');
  });

  test('sub-pages are indexed in FTS5', async () => {
    const customLlm = new (class extends MockLLM {
      private callIdx = 0;
      async complete(messages: ChatMessage[], options?: any): Promise<LLMResponse> {
        this.callIdx++;
        if (this.callIdx === 2) {
          return {
            content: JSON.stringify({
              entities: [{ name: 'TestEntity', type: 'technology', description: 'A test entity.' }],
              concepts: [],
            }),
            tokenUsage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
            model: 'mock',
            finishReason: 'stop',
          };
        }
        return super.complete(messages, options);
      }
    })();

    storage = createFTS5Storage(':memory:');
    const doc = makeDoc();
    await ingestDocument(doc, customLlm, storage, {
      wikiDir: '/tmp/wiki',
      writeToDisk: false,
      extractSubPages: true,
    });

    // Source page + entity page
    expect(storage.getPageCount()).toBe(2);
    const entityPage = storage.getPage('TestEntity');
    expect(entityPage).not.toBeNull();
    expect(entityPage!.type).toBe('entity');
  });

  test('sub-pages have correct wikilinks back to source', async () => {
    const customLlm = new (class extends MockLLM {
      private callIdx = 0;
      async complete(messages: ChatMessage[], options?: any): Promise<LLMResponse> {
        this.callIdx++;
        if (this.callIdx === 2) {
          return {
            content: JSON.stringify({
              entities: [],
              concepts: [{ name: 'Architecture Pattern', description: 'A design approach.' }],
            }),
            tokenUsage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
            model: 'mock',
            finishReason: 'stop',
          };
        }
        return super.complete(messages, options);
      }
    })();

    storage = createFTS5Storage(':memory:');
    const doc = makeDoc({ title: 'System Architecture' });
    const result = await ingestDocument(doc, customLlm, storage, {
      wikiDir: '/tmp/wiki',
      writeToDisk: false,
      extractSubPages: true,
    });

    const conceptPage = result.subPages![0];
    expect(conceptPage.wikilinks).toContain('System Architecture');
    expect(conceptPage.content).toContain('[[System Architecture]]');
  });
});

// Re-import MockLLM for type extension
import { MockLLM } from '../../src/providers/llm.ts';
