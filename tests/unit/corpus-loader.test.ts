/**
 * Unit tests for corpus document loader.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadCorpus, getCategories, filterByCategory } from '../../src/corpus/loader.ts';
import { resetConfig } from '../../src/config.ts';
import { resetLogger } from '../../src/logger.ts';
import type { CorpusCategory } from '../../src/types.ts';

describe('Corpus Loader', () => {
  let tempDir: string;

  beforeEach(async () => {
    resetConfig();
    resetLogger();
    tempDir = await mkdtemp(join(tmpdir(), 'corpus-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns empty array for empty directory', async () => {
    const docs = await loadCorpus(tempDir);
    expect(docs).toHaveLength(0);
  });

  it('returns empty array for non-existent directory', async () => {
    const docs = await loadCorpus(join(tempDir, 'nonexistent'));
    expect(docs).toHaveLength(0);
  });

  it('loads .md files from category directories', async () => {
    // Create category dirs with files
    await mkdir(join(tempDir, 'technical'), { recursive: true });
    await writeFile(
      join(tempDir, 'technical', 'api-design.md'),
      '# API Design\n\nREST best practices for modern APIs.',
    );

    const docs = await loadCorpus(tempDir);
    expect(docs).toHaveLength(1);
    expect(docs[0].category).toBe('technical');
    expect(docs[0].title).toBe('API Design');
    expect(docs[0].content).toContain('REST best practices');
    expect(docs[0].relativePath).toBe('technical/api-design.md');
  });

  it('loads .txt files from category directories', async () => {
    await mkdir(join(tempDir, 'narrative'), { recursive: true });
    await writeFile(
      join(tempDir, 'narrative', 'story.txt'),
      'Once upon a time, there was a software engineer.',
    );

    const docs = await loadCorpus(tempDir);
    expect(docs).toHaveLength(1);
    expect(docs[0].category).toBe('narrative');
    expect(docs[0].content).toContain('Once upon a time');
  });

  it('loads files across all four categories', async () => {
    const categories: CorpusCategory[] = [
      'technical',
      'narrative',
      'multi-doc',
      'evolving',
    ];

    for (const cat of categories) {
      await mkdir(join(tempDir, cat), { recursive: true });
      await writeFile(
        join(tempDir, cat, `${cat}-doc.md`),
        `# ${cat} Document\n\nContent for ${cat} category.`,
      );
    }

    const docs = await loadCorpus(tempDir);
    expect(docs).toHaveLength(4);

    const foundCategories = getCategories(docs);
    expect(foundCategories.sort()).toEqual(categories.sort());
  });

  it('parses YAML frontmatter correctly', async () => {
    await mkdir(join(tempDir, 'technical'), { recursive: true });
    await writeFile(
      join(tempDir, 'technical', 'typed-doc.md'),
      [
        '---',
        'title: "Custom Title"',
        'author: "Test Author"',
        'version: 2',
        '---',
        '',
        '# Heading',
        '',
        'Body content here.',
      ].join('\n'),
    );

    const docs = await loadCorpus(tempDir);
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe('Custom Title');
    expect(docs[0].metadata.author).toBe('Test Author');
    expect(docs[0].metadata.version).toBe(2);
  });

  it('generates correct IDs from file paths', async () => {
    await mkdir(join(tempDir, 'technical'), { recursive: true });
    await writeFile(
      join(tempDir, 'technical', 'my-cool-doc.md'),
      '# My Cool Doc',
    );

    const docs = await loadCorpus(tempDir);
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe('technical-my-cool-doc');
  });

  it('skips files not in a recognized category directory', async () => {
    // File at root level (no category dir)
    await writeFile(join(tempDir, 'orphan.md'), '# Orphan');

    // File in unrecognized directory
    await mkdir(join(tempDir, 'random'), { recursive: true });
    await writeFile(join(tempDir, 'random', 'file.md'), '# Random');

    const docs = await loadCorpus(tempDir);
    expect(docs).toHaveLength(0);
  });

  it('skips hidden files', async () => {
    await mkdir(join(tempDir, 'technical'), { recursive: true });
    await writeFile(join(tempDir, 'technical', '.hidden.md'), '# Hidden');
    await writeFile(
      join(tempDir, 'technical', 'visible.md'),
      '# Visible',
    );

    const docs = await loadCorpus(tempDir);
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe('Visible');
  });

  it('handles nested subdirectories within categories', async () => {
    await mkdir(join(tempDir, 'technical', 'deep', 'nested'), {
      recursive: true,
    });
    await writeFile(
      join(tempDir, 'technical', 'deep', 'nested', 'deep-doc.md'),
      '# Deep Doc',
    );

    const docs = await loadCorpus(tempDir);
    expect(docs).toHaveLength(1);
    expect(docs[0].category).toBe('technical');
    expect(docs[0].relativePath).toContain('deep/nested/deep-doc.md');
  });

  it('includes file size in sizeBytes', async () => {
    await mkdir(join(tempDir, 'technical'), { recursive: true });
    const content = 'A'.repeat(500);
    await writeFile(join(tempDir, 'technical', 'sized.md'), content);

    const docs = await loadCorpus(tempDir);
    expect(docs).toHaveLength(1);
    expect(docs[0].sizeBytes).toBe(500);
  });

  it('filterByCategory works correctly', async () => {
    const categories: CorpusCategory[] = ['technical', 'narrative'];

    for (const cat of categories) {
      await mkdir(join(tempDir, cat), { recursive: true });
      await writeFile(
        join(tempDir, cat, `${cat}.md`),
        `# ${cat}`,
      );
    }

    const docs = await loadCorpus(tempDir);
    const techDocs = filterByCategory(docs, 'technical');
    expect(techDocs).toHaveLength(1);
    expect(techDocs[0].category).toBe('technical');

    const narrativeDocs = filterByCategory(docs, 'narrative');
    expect(narrativeDocs).toHaveLength(1);
    expect(narrativeDocs[0].category).toBe('narrative');
  });

  it('falls back to filename for title when no frontmatter or H1', async () => {
    await mkdir(join(tempDir, 'technical'), { recursive: true });
    await writeFile(
      join(tempDir, 'technical', 'no-heading.md'),
      'Just some plain text without any heading.',
    );

    const docs = await loadCorpus(tempDir);
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe('No Heading');
  });
});
