/**
 * Unit tests for src/wiki-agent/wiki/fts5-storage.ts
 *
 * Tests: indexing, search, retrieval, backlinks, orphan detection.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { WikiFTS5Storage, createFTS5Storage } from '../../src/wiki-agent/wiki/fts5-storage.ts';
import type { WikiPage } from '../../src/types.ts';

// Silence logger during tests
process.env.LOG_LEVEL = 'silent';

function makePage(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    title: 'Test Page',
    type: 'source',
    tags: ['test'],
    sources: ['test.md'],
    content: 'This is test content about Meridian Data Platform.',
    wikilinks: [],
    created: '2025-01-01',
    updated: '2025-01-01',
    ...overrides,
  };
}

describe('WikiFTS5Storage', () => {
  let storage: WikiFTS5Storage;

  beforeEach(() => {
    storage = createFTS5Storage(':memory:');
  });

  afterEach(() => {
    storage.close();
  });

  test('initializes with zero pages', () => {
    expect(storage.getPageCount()).toBe(0);
    expect(storage.getAllTitles()).toEqual([]);
  });

  test('indexes a single page', () => {
    storage.upsertPage(makePage());
    expect(storage.getPageCount()).toBe(1);
  });

  test('retrieves a page by title', () => {
    const page = makePage({ title: 'Retrieval Test' });
    storage.upsertPage(page);

    const retrieved = storage.getPage('Retrieval Test');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.title).toBe('Retrieval Test');
    expect(retrieved!.type).toBe('source');
    expect(retrieved!.content).toContain('Meridian');
  });

  test('returns null for non-existent page', () => {
    expect(storage.getPage('Does Not Exist')).toBeNull();
  });

  test('upserts (updates) existing page', () => {
    storage.upsertPage(makePage({ title: 'Update Me', content: 'Version 1' }));
    storage.upsertPage(makePage({ title: 'Update Me', content: 'Version 2' }));

    expect(storage.getPageCount()).toBe(1);
    const page = storage.getPage('Update Me');
    expect(page!.content).toBe('Version 2');
  });

  test('indexes multiple pages in batch', () => {
    const pages = [
      makePage({ title: 'Page A' }),
      makePage({ title: 'Page B' }),
      makePage({ title: 'Page C' }),
    ];
    storage.upsertPages(pages);
    expect(storage.getPageCount()).toBe(3);
    expect(storage.getAllTitles()).toEqual(['Page A', 'Page B', 'Page C']);
  });

  test('deletes a page', () => {
    storage.upsertPage(makePage({ title: 'To Delete' }));
    expect(storage.getPageCount()).toBe(1);

    const deleted = storage.deletePage('To Delete');
    expect(deleted).toBe(true);
    expect(storage.getPageCount()).toBe(0);
  });

  test('delete returns false for non-existent page', () => {
    expect(storage.deletePage('Ghost')).toBe(false);
  });

  test('preserves tags as JSON array', () => {
    storage.upsertPage(makePage({ title: 'Tagged', tags: ['alpha', 'beta', 'gamma'] }));
    const page = storage.getPage('Tagged');
    expect(page!.tags).toEqual(['alpha', 'beta', 'gamma']);
  });

  test('preserves sources as JSON array', () => {
    storage.upsertPage(makePage({ title: 'Sourced', sources: ['a.md', 'b.md'] }));
    const page = storage.getPage('Sourced');
    expect(page!.sources).toEqual(['a.md', 'b.md']);
  });

  test('preserves wikilinks as JSON array', () => {
    storage.upsertPage(makePage({ title: 'Linked', wikilinks: ['Page A', 'Page B'] }));
    const page = storage.getPage('Linked');
    expect(page!.wikilinks).toEqual(['Page A', 'Page B']);
  });

  test('preserves filePath', () => {
    storage.upsertPage(makePage({ title: 'With Path', filePath: 'sources/test.md' }));
    const page = storage.getPage('With Path');
    expect(page!.filePath).toBe('sources/test.md');
  });
});

describe('FTS5 Search', () => {
  let storage: WikiFTS5Storage;

  beforeEach(() => {
    storage = createFTS5Storage(':memory:');
    storage.upsertPages([
      makePage({
        title: 'API Reference',
        content: 'RESTful API documentation for Meridian Data Platform endpoints.',
        tags: ['api', 'technical'],
      }),
      makePage({
        title: 'System Architecture',
        content: 'Distributed system architecture with Kafka and PostgreSQL.',
        tags: ['architecture', 'technical'],
      }),
      makePage({
        title: 'Migration Guide',
        content: 'How to migrate from legacy Hadoop systems to Meridian.',
        tags: ['migration', 'guide'],
      }),
    ]);
  });

  afterEach(() => {
    storage.close();
  });

  test('searches by content keyword', () => {
    const results = storage.search('Kafka');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('System Architecture');
  });

  test('searches by title', () => {
    const results = storage.search('API Reference');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('API Reference');
  });

  test('returns empty for no matches', () => {
    const results = storage.search('quantum computing');
    expect(results).toEqual([]);
  });

  test('returns empty for empty query', () => {
    expect(storage.search('')).toEqual([]);
  });

  test('respects limit parameter', () => {
    const results = storage.search('Meridian', 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  test('results include snippet with highlights', () => {
    const results = storage.search('Meridian');
    expect(results.length).toBeGreaterThan(0);
    // Snippets should contain some text
    expect(results[0].snippet.length).toBeGreaterThan(0);
  });

  test('results include rank score', () => {
    const results = storage.search('Meridian');
    for (const result of results) {
      expect(typeof result.rank).toBe('number');
    }
  });

  test('handles FTS5 syntax errors gracefully', () => {
    // Invalid FTS5 syntax should not throw
    const results = storage.search('AND OR NOT');
    // Just ensure it doesn't throw — result may be empty
    expect(Array.isArray(results)).toBe(true);
  });
});

describe('Backlinks and Orphans', () => {
  let storage: WikiFTS5Storage;

  beforeEach(() => {
    storage = createFTS5Storage(':memory:');
    storage.upsertPages([
      makePage({
        title: 'Overview',
        wikilinks: ['System Architecture', 'API Reference'],
      }),
      makePage({
        title: 'System Architecture',
        wikilinks: ['Overview'],
      }),
      makePage({
        title: 'API Reference',
        wikilinks: [],
      }),
      makePage({
        title: 'Orphan Page',
        wikilinks: [],
      }),
    ]);
  });

  afterEach(() => {
    storage.close();
  });

  test('finds backlinks for a page', () => {
    const backlinks = storage.getBacklinks('System Architecture');
    expect(backlinks).toContain('Overview');
  });

  test('returns empty backlinks for orphan', () => {
    const backlinks = storage.getBacklinks('Orphan Page');
    expect(backlinks).toEqual([]);
  });

  test('identifies orphan pages', () => {
    const orphans = storage.getOrphanPages();
    // Overview is linked by System Architecture; System Architecture is linked by Overview
    // API Reference is linked by Overview
    // Orphan Page is linked by nobody
    expect(orphans).toContain('Orphan Page');
  });
});
