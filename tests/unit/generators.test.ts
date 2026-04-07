/**
 * Unit tests for src/wiki-agent/ingest/generators.ts
 *
 * Tests: index.md generation, overview.md generation.
 */

import { describe, test, expect, afterEach } from 'bun:test';
import { join } from 'node:path';
import { readFile, rm, mkdir } from 'node:fs/promises';
import { generateIndexPage, generateOverviewPage } from '../../src/wiki-agent/ingest/generators.ts';
import { parseWikiPage } from '../../src/wiki-agent/wiki/page.ts';
import type { WikiPage } from '../../src/types.ts';

// Silence logger during tests
process.env.LOG_LEVEL = 'silent';

const TEST_WIKI_DIR = join(import.meta.dir, '..', '..', '.test-wiki-gen');

function makePage(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    title: 'Test Page',
    type: 'source',
    tags: ['test'],
    sources: ['test.md'],
    content: 'Test content.',
    wikilinks: [],
    created: '2025-01-01',
    updated: '2025-01-01',
    ...overrides,
  };
}

afterEach(async () => {
  try {
    await rm(TEST_WIKI_DIR, { recursive: true, force: true });
  } catch {}
});

describe('generateIndexPage', () => {
  test('creates index.md with all page titles', async () => {
    const pages = [
      makePage({ title: 'API Reference', type: 'source', tags: ['api'] }),
      makePage({ title: 'Kafka', type: 'entity', tags: ['technology'] }),
      makePage({ title: 'REST', type: 'concept', tags: ['pattern'] }),
    ];

    const indexPage = await generateIndexPage(pages, TEST_WIKI_DIR);

    expect(indexPage.title).toBe('Index');
    expect(indexPage.type).toBe('synthesis');
    expect(indexPage.wikilinks).toContain('API Reference');
    expect(indexPage.wikilinks).toContain('Kafka');
    expect(indexPage.wikilinks).toContain('REST');
    expect(indexPage.content).toContain('[[API Reference]]');
    expect(indexPage.content).toContain('[[Kafka]]');
    expect(indexPage.content).toContain('[[REST]]');
  });

  test('writes index.md to disk', async () => {
    const pages = [makePage({ title: 'Test' })];
    await generateIndexPage(pages, TEST_WIKI_DIR);

    const raw = await readFile(join(TEST_WIKI_DIR, 'index.md'), 'utf-8');
    const parsed = parseWikiPage(raw, 'index.md');
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe('Index');
  });

  test('groups pages by type', async () => {
    const pages = [
      makePage({ title: 'Source A', type: 'source' }),
      makePage({ title: 'Entity A', type: 'entity' }),
      makePage({ title: 'Concept A', type: 'concept' }),
    ];

    const indexPage = await generateIndexPage(pages, TEST_WIKI_DIR);
    expect(indexPage.content).toContain('Source Pages');
    expect(indexPage.content).toContain('Entity Pages');
    expect(indexPage.content).toContain('Concept Pages');
  });

  test('handles empty page list', async () => {
    const indexPage = await generateIndexPage([], TEST_WIKI_DIR);
    expect(indexPage.title).toBe('Index');
    expect(indexPage.content).toContain('Total pages: 0');
  });
});

describe('generateOverviewPage', () => {
  test('creates overview.md with statistics', async () => {
    const pages = [
      makePage({ title: 'Source A', type: 'source', tags: ['api', 'technical'] }),
      makePage({ title: 'Source B', type: 'source', tags: ['docs'] }),
      makePage({ title: 'Entity A', type: 'entity', tags: ['person'] }),
    ];

    const overviewPage = await generateOverviewPage(pages, TEST_WIKI_DIR);

    expect(overviewPage.title).toBe('Overview');
    expect(overviewPage.type).toBe('synthesis');
    expect(overviewPage.content).toContain('Total Pages | 3');
    expect(overviewPage.content).toContain('Source Pages | 2');
    expect(overviewPage.content).toContain('Entity Pages | 1');
  });

  test('writes overview.md to disk', async () => {
    const pages = [makePage({ title: 'Test' })];
    await generateOverviewPage(pages, TEST_WIKI_DIR);

    const raw = await readFile(join(TEST_WIKI_DIR, 'overview.md'), 'utf-8');
    const parsed = parseWikiPage(raw, 'overview.md');
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe('Overview');
  });

  test('lists all unique tags', async () => {
    const pages = [
      makePage({ title: 'A', tags: ['api', 'technical'] }),
      makePage({ title: 'B', tags: ['api', 'docs'] }),
    ];

    const overviewPage = await generateOverviewPage(pages, TEST_WIKI_DIR);
    expect(overviewPage.content).toContain('`api`');
    expect(overviewPage.content).toContain('`technical`');
    expect(overviewPage.content).toContain('`docs`');
  });

  test('includes wikilinks to all pages', async () => {
    const pages = [
      makePage({ title: 'Page Alpha' }),
      makePage({ title: 'Page Beta' }),
    ];

    const overviewPage = await generateOverviewPage(pages, TEST_WIKI_DIR);
    expect(overviewPage.wikilinks).toContain('Page Alpha');
    expect(overviewPage.wikilinks).toContain('Page Beta');
    expect(overviewPage.content).toContain('[[Page Alpha]]');
    expect(overviewPage.content).toContain('[[Page Beta]]');
  });
});
