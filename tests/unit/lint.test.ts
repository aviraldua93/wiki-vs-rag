/**
 * Unit tests for src/wiki-agent/lint/engine.ts
 *
 * Tests: structural lint, semantic lint, full lint pass.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { lintStructural, lintSemantic, runLint } from '../../src/wiki-agent/lint/engine.ts';
import { createFTS5Storage, WikiFTS5Storage } from '../../src/wiki-agent/wiki/fts5-storage.ts';
import { MockLLM } from '../../src/providers/llm.ts';
import type { WikiPage } from '../../src/types.ts';

// Silence logger during tests
process.env.LOG_LEVEL = 'silent';

function makePage(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    title: 'Test Page',
    type: 'source',
    tags: ['test'],
    sources: ['test.md'],
    content: 'Valid content for testing lint engine.',
    wikilinks: [],
    created: '2025-01-01',
    updated: '2025-01-01',
    ...overrides,
  };
}

describe('lintStructural', () => {
  let storage: WikiFTS5Storage;

  beforeEach(() => {
    storage = createFTS5Storage(':memory:');
  });

  afterEach(() => {
    storage.close();
  });

  test('returns no issues for valid pages with resolved links', () => {
    storage.upsertPages([
      makePage({ title: 'Page A', wikilinks: ['Page B'] }),
      makePage({ title: 'Page B', wikilinks: ['Page A'] }),
    ]);

    const issues = lintStructural(storage);
    // No broken links (both exist), but both have backlinks so no orphan issues
    const brokenLinks = issues.filter((i) => i.category === 'broken-link');
    expect(brokenLinks).toEqual([]);
  });

  test('detects broken wikilinks', () => {
    storage.upsertPages([
      makePage({ title: 'Page A', wikilinks: ['Non Existent Page'] }),
    ]);

    const issues = lintStructural(storage);
    const brokenLinks = issues.filter((i) => i.category === 'broken-link');
    expect(brokenLinks.length).toBe(1);
    expect(brokenLinks[0].message).toContain('Non Existent Page');
    expect(brokenLinks[0].severity).toBe('warning');
  });

  test('detects multiple broken links on one page', () => {
    storage.upsertPages([
      makePage({
        title: 'Broken',
        wikilinks: ['Missing A', 'Missing B', 'Missing C'],
      }),
    ]);

    const issues = lintStructural(storage);
    const brokenLinks = issues.filter((i) => i.category === 'broken-link');
    expect(brokenLinks.length).toBe(3);
  });

  test('detects orphan pages', () => {
    storage.upsertPages([
      makePage({ title: 'Connected A', wikilinks: ['Connected B'] }),
      makePage({ title: 'Connected B', wikilinks: ['Connected A'] }),
      makePage({ title: 'Orphan', wikilinks: [] }),
    ]);

    const issues = lintStructural(storage);
    const orphans = issues.filter((i) => i.category === 'orphan');
    expect(orphans.some((o) => o.page === 'Orphan')).toBe(true);
  });

  test('detects structural validation errors', () => {
    storage.upsertPages([
      makePage({ title: '', content: '' }), // Missing title and content
    ]);

    const issues = lintStructural(storage);
    const structural = issues.filter((i) => i.category === 'structural');
    expect(structural.length).toBeGreaterThan(0);
  });

  test('handles empty storage', () => {
    const issues = lintStructural(storage);
    expect(issues).toEqual([]);
  });
});

describe('lintSemantic', () => {
  let storage: WikiFTS5Storage;
  let llm: MockLLM;

  beforeEach(() => {
    storage = createFTS5Storage(':memory:');
    llm = new MockLLM();
  });

  afterEach(() => {
    storage.close();
  });

  test('calls LLM for each page', async () => {
    storage.upsertPages([
      makePage({ title: 'Page A' }),
      makePage({ title: 'Page B' }),
    ]);

    await lintSemantic(storage, llm);
    expect(llm.getCallCount()).toBe(2);
  });

  test('returns no semantic issues for mock LLM', async () => {
    storage.upsertPages([makePage({ title: 'Clean Page' })]);

    // MockLLM's lint pattern returns { issues: [], suggestions: [...], score: 0.95 }
    const result = await lintSemantic(storage, llm);
    expect(result.issues).toEqual([]);
  });

  test('handles empty storage', async () => {
    const result = await lintSemantic(storage, llm);
    expect(result.issues).toEqual([]);
    expect(llm.getCallCount()).toBe(0);
  });
});

describe('runLint (full lint pass)', () => {
  let storage: WikiFTS5Storage;
  let llm: MockLLM;

  beforeEach(() => {
    storage = createFTS5Storage(':memory:');
    llm = new MockLLM();
  });

  afterEach(() => {
    storage.close();
  });

  test('produces a complete LintResult', async () => {
    storage.upsertPages([
      makePage({ title: 'Page A', wikilinks: ['Page B'] }),
      makePage({ title: 'Page B', wikilinks: ['Page A'] }),
    ]);

    const result = await runLint(storage, llm);
    expect(result.pagesChecked).toBe(2);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(Array.isArray(result.issues)).toBe(true);
    expect(typeof result.pagesWithIssues).toBe('number');
  });

  test('score decreases with more issues', async () => {
    storage.upsertPages([
      makePage({
        title: 'Problematic',
        wikilinks: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
      }),
    ]);

    const result = await runLint(storage, llm);
    // 10 broken links = 10 warnings → score should be penalized
    expect(result.issues.filter((i) => i.category === 'broken-link').length).toBe(10);
    expect(result.score).toBeLessThan(1);
  });

  test('handles empty storage', async () => {
    const result = await runLint(storage, llm);
    expect(result.pagesChecked).toBe(0);
    expect(result.issues).toEqual([]);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});
