/**
 * Index and overview page generators for the compiled wiki.
 *
 * Auto-generates:
 * - index.md: Master catalog of all wiki pages
 * - overview.md: High-level knowledge base summary
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { WikiPage } from '../../types.ts';
import { serializeWikiPage } from '../wiki/page.ts';
import { createLogger } from '../../logger.ts';

const log = createLogger('wiki-generators');

/**
 * Generate or append to the wiki/log.md — an append-only chronological log
 * per Karpathy's methodology.
 *
 * Format: ## [YYYY-MM-DD] action | Description
 */
export async function appendToLog(
  entries: Array<{ action: string; description: string }>,
  wikiDir: string,
): Promise<void> {
  const logPath = join(wikiDir, 'log.md');
  const now = new Date().toISOString().split('T')[0];

  let existing = '';
  try {
    const { readFile } = await import('node:fs/promises');
    existing = await readFile(logPath, 'utf-8');
  } catch {
    // File doesn't exist yet — create with header
    existing = `---
title: "Activity Log"
type: synthesis
tags: [log, auto-generated]
sources: []
created: ${now}
updated: ${now}
---

# Wiki Activity Log

Append-only chronological log of all wiki operations.

`;
  }

  const newEntries = entries
    .map((e) => `## [${now}] ${e.action} | ${e.description}`)
    .join('\n\n');

  const updated = existing.trimEnd() + '\n\n' + newEntries + '\n';

  await mkdir(wikiDir, { recursive: true });
  await writeFile(logPath, updated, 'utf-8');
  log.info({ entryCount: entries.length }, 'Appended to log.md');
}

/**
 * Generate the master index.md page listing all compiled wiki pages.
 */
export async function generateIndexPage(
  pages: WikiPage[],
  wikiDir: string,
): Promise<WikiPage> {
  const byType = new Map<string, WikiPage[]>();
  for (const page of pages) {
    const list = byType.get(page.type) ?? [];
    list.push(page);
    byType.set(page.type, list);
  }

  const sections: string[] = ['# Wiki Index\n'];
  sections.push(`Total pages: ${pages.length}\n`);

  const typeOrder = ['source', 'entity', 'concept', 'synthesis'];
  for (const type of typeOrder) {
    const typedPages = byType.get(type);
    if (!typedPages || typedPages.length === 0) continue;

    sections.push(`## ${type.charAt(0).toUpperCase() + type.slice(1)} Pages\n`);
    const sorted = [...typedPages].sort((a, b) => a.title.localeCompare(b.title));
    for (const p of sorted) {
      const path = p.filePath ?? `${type}s/${p.title.toLowerCase().replace(/\s+/g, '-')}.md`;
      sections.push(`- [[${p.title}]] — ${p.tags.slice(0, 3).join(', ') || 'untagged'}`);
    }
    sections.push('');
  }

  const now = new Date().toISOString().split('T')[0];
  const indexPage: WikiPage = {
    title: 'Index',
    type: 'synthesis',
    tags: ['index', 'auto-generated'],
    sources: [],
    content: sections.join('\n'),
    wikilinks: pages.map((p) => p.title),
    created: now,
    updated: now,
    filePath: 'index.md',
  };

  await mkdir(wikiDir, { recursive: true });
  await writeFile(join(wikiDir, 'index.md'), serializeWikiPage(indexPage), 'utf-8');

  log.info({ pageCount: pages.length }, 'Generated index.md');
  return indexPage;
}

/**
 * Generate the overview.md page with a high-level knowledge base summary.
 */
export async function generateOverviewPage(
  pages: WikiPage[],
  wikiDir: string,
): Promise<WikiPage> {
  const sourceCount = pages.filter((p) => p.type === 'source').length;
  const entityCount = pages.filter((p) => p.type === 'entity').length;
  const conceptCount = pages.filter((p) => p.type === 'concept').length;
  const synthesisCount = pages.filter((p) => p.type === 'synthesis').length;

  // Collect all unique tags
  const allTags = new Set<string>();
  for (const page of pages) {
    for (const tag of page.tags) {
      allTags.add(tag);
    }
  }

  // Collect all unique sources
  const allSources = new Set<string>();
  for (const page of pages) {
    for (const source of page.sources) {
      allSources.add(source);
    }
  }

  // Gather wikilink stats
  const totalWikilinks = pages.reduce((sum, p) => sum + p.wikilinks.length, 0);
  const uniqueTargets = new Set(pages.flatMap((p) => p.wikilinks));

  const content = `# Knowledge Base Overview

## Statistics

| Metric | Count |
|--------|-------|
| Total Pages | ${pages.length} |
| Source Pages | ${sourceCount} |
| Entity Pages | ${entityCount} |
| Concept Pages | ${conceptCount} |
| Synthesis Pages | ${synthesisCount} |
| Unique Tags | ${allTags.size} |
| Source Documents | ${allSources.size} |
| Total Wikilinks | ${totalWikilinks} |
| Unique Link Targets | ${uniqueTargets.size} |

## Tags

${[...allTags].sort().map((t) => `\`${t}\``).join(', ')}

## Source Documents

${[...allSources].sort().map((s) => `- ${s}`).join('\n')}

## Pages by Type

### Sources
${pages.filter((p) => p.type === 'source').map((p) => `- [[${p.title}]]`).join('\n') || '_None_'}

### Entities
${pages.filter((p) => p.type === 'entity').map((p) => `- [[${p.title}]]`).join('\n') || '_None_'}

### Concepts
${pages.filter((p) => p.type === 'concept').map((p) => `- [[${p.title}]]`).join('\n') || '_None_'}

### Syntheses
${pages.filter((p) => p.type === 'synthesis').map((p) => `- [[${p.title}]]`).join('\n') || '_None_'}
`;

  const now = new Date().toISOString().split('T')[0];
  const overviewPage: WikiPage = {
    title: 'Overview',
    type: 'synthesis',
    tags: ['overview', 'auto-generated'],
    sources: [],
    content,
    wikilinks: pages.map((p) => p.title),
    created: now,
    updated: now,
    filePath: 'overview.md',
  };

  await mkdir(wikiDir, { recursive: true });
  await writeFile(join(wikiDir, 'overview.md'), serializeWikiPage(overviewPage), 'utf-8');

  log.info({ pageCount: pages.length }, 'Generated overview.md');
  return overviewPage;
}
