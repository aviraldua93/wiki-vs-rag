/**
 * Unit tests for src/wiki-agent/wiki/page.ts
 *
 * Tests: frontmatter parsing, wikilink extraction, serialization, validation.
 */

import { describe, test, expect } from 'bun:test';
import {
  parseWikiPage,
  serializeWikiPage,
  extractWikilinks,
  validateWikiPage,
} from '../../src/wiki-agent/wiki/page.ts';
import type { WikiPage } from '../../src/types.ts';

// Silence logger during tests
process.env.LOG_LEVEL = 'silent';

describe('extractWikilinks', () => {
  test('extracts simple wikilinks', () => {
    const content = 'See [[Overview]] and [[Index]] for more.';
    const links = extractWikilinks(content);
    expect(links).toEqual(['Overview', 'Index']);
  });

  test('extracts wikilinks with spaces', () => {
    const links = extractWikilinks('Related to [[Mock Concept]] and [[Related Topic]].');
    expect(links).toEqual(['Mock Concept', 'Related Topic']);
  });

  test('deduplicates wikilinks', () => {
    const links = extractWikilinks('See [[A]], then [[B]], then [[A]] again.');
    expect(links).toEqual(['A', 'B']);
  });

  test('returns empty array when no wikilinks', () => {
    expect(extractWikilinks('No links here.')).toEqual([]);
  });

  test('handles empty string', () => {
    expect(extractWikilinks('')).toEqual([]);
  });

  test('handles nested brackets gracefully', () => {
    const links = extractWikilinks('Check [[Valid Link]].');
    expect(links).toEqual(['Valid Link']);
  });

  test('handles wikilinks at start and end of content', () => {
    const links = extractWikilinks('[[First]] middle text [[Last]]');
    expect(links).toEqual(['First', 'Last']);
  });

  test('trims whitespace from link targets', () => {
    const links = extractWikilinks('See [[ Padded Link ]].');
    expect(links).toEqual(['Padded Link']);
  });
});

describe('parseWikiPage', () => {
  test('parses valid wiki page with full frontmatter', () => {
    const raw = `---
title: "Test Page"
type: entity
tags: [test, unit]
sources: [doc1.md, doc2.md]
created: "2025-01-01"
updated: "2025-03-15"
---

# Test Page

This is content with [[Link One]] and [[Link Two]].`;

    const page = parseWikiPage(raw, 'entities/test-page.md');
    expect(page).not.toBeNull();
    expect(page!.title).toBe('Test Page');
    expect(page!.type).toBe('entity');
    expect(page!.tags).toEqual(['test', 'unit']);
    expect(page!.sources).toEqual(['doc1.md', 'doc2.md']);
    expect(page!.wikilinks).toEqual(['Link One', 'Link Two']);
    expect(page!.created).toBe('2025-01-01');
    expect(page!.updated).toBe('2025-03-15');
    expect(page!.filePath).toBe('entities/test-page.md');
  });

  test('defaults type to source for missing type', () => {
    const raw = `---
title: "No Type"
---

Content.`;
    const page = parseWikiPage(raw);
    expect(page!.type).toBe('source');
  });

  test('defaults type to source for invalid type', () => {
    const raw = `---
title: "Bad Type"
type: invalid
---

Content.`;
    const page = parseWikiPage(raw);
    expect(page!.type).toBe('source');
  });

  test('handles missing frontmatter fields gracefully', () => {
    const raw = `---
title: "Minimal"
---

Just content.`;
    const page = parseWikiPage(raw);
    expect(page!.title).toBe('Minimal');
    expect(page!.tags).toEqual([]);
    expect(page!.sources).toEqual([]);
    expect(page!.wikilinks).toEqual([]);
  });

  test('handles page with no frontmatter', () => {
    const raw = `# Just a Heading

No frontmatter at all. See [[Some Link]].`;
    const page = parseWikiPage(raw);
    expect(page).not.toBeNull();
    expect(page!.title).toBe('');
    expect(page!.wikilinks).toEqual(['Some Link']);
  });

  test('returns null for completely empty content', () => {
    const page = parseWikiPage('');
    // gray-matter handles empty string; page will exist but have empty content
    expect(page).not.toBeNull();
    expect(page!.content).toBe('');
  });

  test('handles non-string tags gracefully', () => {
    const raw = `---
title: "Mixed Tags"
tags: [valid, 123, true]
---

Content.`;
    const page = parseWikiPage(raw);
    // Only string tags are kept
    expect(page!.tags).toEqual(['valid']);
  });

  test('parses all valid page types', () => {
    for (const type of ['source', 'entity', 'concept', 'synthesis'] as const) {
      const raw = `---\ntitle: "${type} page"\ntype: ${type}\n---\n\nContent.`;
      const page = parseWikiPage(raw);
      expect(page!.type).toBe(type);
    }
  });
});

describe('serializeWikiPage', () => {
  test('produces valid YAML frontmatter + content', () => {
    const page: WikiPage = {
      title: 'Serialized Page',
      type: 'concept',
      tags: ['serialize', 'test'],
      sources: ['src.md'],
      content: '# Serialized Page\n\nContent with [[Link]].',
      wikilinks: ['Link'],
      created: '2025-01-01',
      updated: '2025-03-01',
    };

    const serialized = serializeWikiPage(page);
    expect(serialized).toContain('title: Serialized Page');
    expect(serialized).toContain('type: concept');
    expect(serialized).toContain('Content with [[Link]]');
  });

  test('roundtrip: parse → serialize → parse preserves data', () => {
    const original = `---
title: "Roundtrip Test"
type: entity
tags:
  - roundtrip
  - test
sources:
  - original.md
created: "2025-01-01"
updated: "2025-02-01"
---

# Roundtrip Test

Content with [[Cross Reference]].`;

    const page1 = parseWikiPage(original);
    expect(page1).not.toBeNull();

    const serialized = serializeWikiPage(page1!);
    const page2 = parseWikiPage(serialized);
    expect(page2).not.toBeNull();

    expect(page2!.title).toBe(page1!.title);
    expect(page2!.type).toBe(page1!.type);
    expect(page2!.tags).toEqual(page1!.tags);
    expect(page2!.sources).toEqual(page1!.sources);
    expect(page2!.wikilinks).toEqual(page1!.wikilinks);
  });
});

describe('validateWikiPage', () => {
  const validPage: WikiPage = {
    title: 'Valid Page',
    type: 'source',
    tags: ['test'],
    sources: ['src.md'],
    content: 'Some real content here.',
    wikilinks: ['Other Page'],
    created: '2025-01-01',
    updated: '2025-01-01',
  };

  test('returns no errors for valid page', () => {
    expect(validateWikiPage(validPage)).toEqual([]);
  });

  test('reports missing title', () => {
    const errors = validateWikiPage({ ...validPage, title: '' });
    expect(errors.some((e) => e.includes('title'))).toBe(true);
  });

  test('reports empty content', () => {
    const errors = validateWikiPage({ ...validPage, content: '' });
    expect(errors.some((e) => e.includes('content'))).toBe(true);
  });

  test('reports whitespace-only content', () => {
    const errors = validateWikiPage({ ...validPage, content: '   \n  ' });
    expect(errors.some((e) => e.includes('content'))).toBe(true);
  });

  test('reports self-referential wikilink', () => {
    const selfRef = {
      ...validPage,
      wikilinks: ['Valid Page', 'Other Page'],
    };
    const errors = validateWikiPage(selfRef);
    expect(errors.some((e) => e.includes('self-referential'))).toBe(true);
  });

  test('no self-referential error when page has no self-link', () => {
    const errors = validateWikiPage(validPage);
    expect(errors.some((e) => e.includes('self-referential'))).toBe(false);
  });
});
