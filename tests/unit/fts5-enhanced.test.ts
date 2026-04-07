/**
 * Unit tests for enhanced FTS5 storage: CRUD, wikilink resolution, re-indexing.
 *
 * Tests the new features: createPage, updatePage, resolveWikilink,
 * searchPages, getPagesByType, getBrokenWikilinks, reindexFromDisk.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { WikiFTS5Storage, createFTS5Storage } from '../../src/wiki-agent/wiki/fts5-storage.ts';
import { serializeWikiPage } from '../../src/wiki-agent/wiki/page.ts';
import type { WikiPage } from '../../src/types.ts';

// Silence logger during tests
process.env.LOG_LEVEL = 'silent';

const TEST_WIKI_DIR = join(import.meta.dir, '..', '..', '.test-wiki-fts5');

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

describe('CRUD Operations', () => {
  let storage: WikiFTS5Storage;

  beforeEach(() => {
    storage = createFTS5Storage(':memory:');
  });

  afterEach(() => {
    storage.close();
  });

  test('createPage inserts a new page', () => {
    const page = makePage({ title: 'New Page' });
    storage.createPage(page);
    expect(storage.getPageCount()).toBe(1);
    expect(storage.getPage('New Page')).not.toBeNull();
  });

  test('createPage throws if page already exists', () => {
    const page = makePage({ title: 'Duplicate' });
    storage.createPage(page);
    expect(() => storage.createPage(page)).toThrow('Page already exists: Duplicate');
  });

  test('updatePage modifies an existing page', () => {
    const page = makePage({ title: 'Updatable', content: 'Version 1' });
    storage.createPage(page);

    const updated = { ...page, content: 'Version 2', updated: '2025-06-01' };
    storage.updatePage(updated);

    const retrieved = storage.getPage('Updatable');
    expect(retrieved!.content).toBe('Version 2');
    expect(retrieved!.updated).toBe('2025-06-01');
  });

  test('updatePage throws if page does not exist', () => {
    const page = makePage({ title: 'Ghost' });
    expect(() => storage.updatePage(page)).toThrow('Page not found: Ghost');
  });

  test('deletePage removes page from index and search', () => {
    storage.createPage(makePage({ title: 'Deletable', content: 'Searchable content about Kafka.' }));
    expect(storage.getPageCount()).toBe(1);

    const deleted = storage.deletePage('Deletable');
    expect(deleted).toBe(true);
    expect(storage.getPageCount()).toBe(0);
    expect(storage.getPage('Deletable')).toBeNull();

    // FTS5 should not find it either
    const results = storage.search('Kafka');
    expect(results.length).toBe(0);
  });

  test('getPage returns full page with all fields', () => {
    const page = makePage({
      title: 'Full Page',
      type: 'entity',
      tags: ['tag1', 'tag2'],
      sources: ['source1.md', 'source2.md'],
      content: 'Rich content here.',
      wikilinks: ['Other Page', 'Third Page'],
      created: '2025-01-15',
      updated: '2025-03-20',
      filePath: 'entities/full-page.md',
    });
    storage.createPage(page);

    const retrieved = storage.getPage('Full Page')!;
    expect(retrieved.title).toBe('Full Page');
    expect(retrieved.type).toBe('entity');
    expect(retrieved.tags).toEqual(['tag1', 'tag2']);
    expect(retrieved.sources).toEqual(['source1.md', 'source2.md']);
    expect(retrieved.content).toBe('Rich content here.');
    expect(retrieved.wikilinks).toEqual(['Other Page', 'Third Page']);
    expect(retrieved.created).toBe('2025-01-15');
    expect(retrieved.updated).toBe('2025-03-20');
    expect(retrieved.filePath).toBe('entities/full-page.md');
  });
});

describe('searchPages alias', () => {
  let storage: WikiFTS5Storage;

  beforeEach(() => {
    storage = createFTS5Storage(':memory:');
    storage.upsertPages([
      makePage({ title: 'Alpha', content: 'Alpha content about databases.' }),
      makePage({ title: 'Beta', content: 'Beta content about networking.' }),
    ]);
  });

  afterEach(() => {
    storage.close();
  });

  test('searchPages returns same results as search', () => {
    const searchResults = storage.search('databases');
    const searchPagesResults = storage.searchPages('databases');
    expect(searchPagesResults).toEqual(searchResults);
  });

  test('searchPages respects limit', () => {
    const results = storage.searchPages('content', 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });
});

describe('Wikilink Resolution', () => {
  let storage: WikiFTS5Storage;

  beforeEach(() => {
    storage = createFTS5Storage(':memory:');
    storage.upsertPages([
      makePage({
        title: 'API Reference',
        type: 'source',
        tags: ['api', 'docs'],
        filePath: 'sources/api-reference.md',
      }),
      makePage({
        title: 'Kafka',
        type: 'entity',
        tags: ['technology'],
        filePath: 'entities/kafka.md',
      }),
    ]);
  });

  afterEach(() => {
    storage.close();
  });

  test('resolves existing page', () => {
    const resolution = storage.resolveWikilink('API Reference');
    expect(resolution.exists).toBe(true);
    expect(resolution.target).toBe('API Reference');
    expect(resolution.filePath).toBe('sources/api-reference.md');
    expect(resolution.type).toBe('source');
    expect(resolution.tags).toEqual(['api', 'docs']);
  });

  test('resolves missing page', () => {
    const resolution = storage.resolveWikilink('Non Existent');
    expect(resolution.exists).toBe(false);
    expect(resolution.target).toBe('Non Existent');
    expect(resolution.filePath).toBeUndefined();
    expect(resolution.type).toBeUndefined();
  });

  test('resolves multiple wikilinks at once', () => {
    const resolutions = storage.resolveWikilinks(['API Reference', 'Missing', 'Kafka']);
    expect(resolutions.length).toBe(3);
    expect(resolutions[0].exists).toBe(true);
    expect(resolutions[1].exists).toBe(false);
    expect(resolutions[2].exists).toBe(true);
    expect(resolutions[2].type).toBe('entity');
  });

  test('getBrokenWikilinks detects all broken links', () => {
    storage.upsertPage(makePage({
      title: 'Linker',
      wikilinks: ['API Reference', 'Missing A', 'Missing B'],
    }));

    const broken = storage.getBrokenWikilinks();
    expect(broken.length).toBe(2);
    expect(broken.some((b) => b.target === 'Missing A')).toBe(true);
    expect(broken.some((b) => b.target === 'Missing B')).toBe(true);
    expect(broken.every((b) => b.page === 'Linker')).toBe(true);
  });
});

describe('getPagesByType', () => {
  let storage: WikiFTS5Storage;

  beforeEach(() => {
    storage = createFTS5Storage(':memory:');
    storage.upsertPages([
      makePage({ title: 'Source A', type: 'source' }),
      makePage({ title: 'Source B', type: 'source' }),
      makePage({ title: 'Entity A', type: 'entity' }),
      makePage({ title: 'Concept A', type: 'concept' }),
    ]);
  });

  afterEach(() => {
    storage.close();
  });

  test('returns pages of given type', () => {
    const sources = storage.getPagesByType('source');
    expect(sources.length).toBe(2);
    expect(sources.every((p) => p.type === 'source')).toBe(true);
  });

  test('returns empty for type with no pages', () => {
    const syntheses = storage.getPagesByType('synthesis');
    expect(syntheses).toEqual([]);
  });

  test('returns pages sorted by title', () => {
    const sources = storage.getPagesByType('source');
    expect(sources[0].title).toBe('Source A');
    expect(sources[1].title).toBe('Source B');
  });
});

describe('reindexFromDisk', () => {
  let storage: WikiFTS5Storage;

  beforeEach(async () => {
    storage = createFTS5Storage(':memory:');
    await rm(TEST_WIKI_DIR, { recursive: true, force: true }).catch(() => {});
    await mkdir(join(TEST_WIKI_DIR, 'sources'), { recursive: true });
    await mkdir(join(TEST_WIKI_DIR, 'entities'), { recursive: true });
  });

  afterEach(async () => {
    storage.close();
    await rm(TEST_WIKI_DIR, { recursive: true, force: true }).catch(() => {});
  });

  test('indexes wiki files from disk', async () => {
    const page = makePage({
      title: 'Disk Page',
      type: 'source',
      filePath: 'sources/disk-page.md',
    });
    await writeFile(
      join(TEST_WIKI_DIR, 'sources', 'disk-page.md'),
      serializeWikiPage(page),
      'utf-8',
    );

    const count = await storage.reindexFromDisk(TEST_WIKI_DIR);
    expect(count).toBe(1);
    expect(storage.getPageCount()).toBe(1);

    const indexed = storage.getPage('Disk Page');
    expect(indexed).not.toBeNull();
    expect(indexed!.type).toBe('source');
  });

  test('re-index is idempotent', async () => {
    const page = makePage({ title: 'Idempotent Test' });
    await writeFile(
      join(TEST_WIKI_DIR, 'sources', 'idem.md'),
      serializeWikiPage(page),
      'utf-8',
    );

    await storage.reindexFromDisk(TEST_WIKI_DIR);
    expect(storage.getPageCount()).toBe(1);

    // Re-index again — should still be 1 page
    await storage.reindexFromDisk(TEST_WIKI_DIR);
    expect(storage.getPageCount()).toBe(1);
  });

  test('re-index clears old data', async () => {
    // First, add a page directly
    storage.upsertPage(makePage({ title: 'In-Memory Only' }));
    expect(storage.getPageCount()).toBe(1);

    // Write a different page to disk
    const diskPage = makePage({ title: 'From Disk' });
    await writeFile(
      join(TEST_WIKI_DIR, 'sources', 'from-disk.md'),
      serializeWikiPage(diskPage),
      'utf-8',
    );

    // Re-index — should only contain the disk page
    await storage.reindexFromDisk(TEST_WIKI_DIR);
    expect(storage.getPageCount()).toBe(1);
    expect(storage.getPage('In-Memory Only')).toBeNull();
    expect(storage.getPage('From Disk')).not.toBeNull();
  });

  test('indexes files from nested directories', async () => {
    const sourcePage = makePage({ title: 'Source One', type: 'source' });
    const entityPage = makePage({ title: 'Entity One', type: 'entity' });

    await writeFile(
      join(TEST_WIKI_DIR, 'sources', 'source-one.md'),
      serializeWikiPage(sourcePage),
      'utf-8',
    );
    await writeFile(
      join(TEST_WIKI_DIR, 'entities', 'entity-one.md'),
      serializeWikiPage(entityPage),
      'utf-8',
    );

    const count = await storage.reindexFromDisk(TEST_WIKI_DIR);
    expect(count).toBe(2);
    expect(storage.getPage('Source One')).not.toBeNull();
    expect(storage.getPage('Entity One')).not.toBeNull();
  });

  test('search works after re-index', async () => {
    const page = makePage({
      title: 'Searchable After Reindex',
      content: 'Content about PostgreSQL and distributed systems.',
    });
    await writeFile(
      join(TEST_WIKI_DIR, 'sources', 'searchable.md'),
      serializeWikiPage(page),
      'utf-8',
    );

    await storage.reindexFromDisk(TEST_WIKI_DIR);

    const results = storage.search('PostgreSQL');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('Searchable After Reindex');
  });

  test('handles empty directory', async () => {
    const count = await storage.reindexFromDisk(TEST_WIKI_DIR);
    expect(count).toBe(0);
    expect(storage.getPageCount()).toBe(0);
  });
});
