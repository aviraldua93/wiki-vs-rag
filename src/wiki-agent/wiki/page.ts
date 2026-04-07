/**
 * Wiki page model — parsing, serialization, and wikilink extraction.
 *
 * Handles YAML frontmatter + Markdown content per the wiki page schema.
 */

import matter from 'gray-matter';
import type { WikiPage, WikiPageType, WikiPageStatus } from '../../types.ts';
import { createLogger } from '../../logger.ts';

const log = createLogger('wiki-page');

/** Regex to find [[WikiLinks]] in content. */
const WIKILINK_REGEX = /\[\[([^\]]+)\]\]/g;

/** Valid page types. */
const VALID_TYPES: Set<string> = new Set(['source', 'entity', 'concept', 'synthesis']);

/**
 * Extract all [[wikilink]] targets from Markdown content.
 */
export function extractWikilinks(content: string): string[] {
  const links: string[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(WIKILINK_REGEX.source, 'g');
  while ((match = regex.exec(content)) !== null) {
    const target = match[1].trim();
    if (target && !links.includes(target)) {
      links.push(target);
    }
  }
  return links;
}

/**
 * Parse a raw Markdown string (with YAML frontmatter) into a WikiPage.
 *
 * @param raw - Raw file content including frontmatter
 * @param filePath - Relative path within wiki directory
 * @returns Parsed WikiPage, or null if parsing fails
 */
export function parseWikiPage(raw: string, filePath?: string): WikiPage | null {
  try {
    const { data, content } = matter(raw);

    const title = typeof data.title === 'string' ? data.title : '';
    if (!title) {
      log.warn({ filePath }, 'Wiki page missing title in frontmatter');
    }

    const rawType = typeof data.type === 'string' ? data.type : 'source';
    const type: WikiPageType = VALID_TYPES.has(rawType)
      ? (rawType as WikiPageType)
      : 'source';

    const tags: string[] = Array.isArray(data.tags)
      ? data.tags.filter((t: unknown) => typeof t === 'string')
      : [];

    const sources: string[] = Array.isArray(data.sources)
      ? data.sources.filter((s: unknown) => typeof s === 'string')
      : [];

    const wikilinks = extractWikilinks(content);

    const now = new Date().toISOString().split('T')[0];
    const created = typeof data.created === 'string' ? data.created : now;
    const updated = typeof data.updated === 'string' ? data.updated : now;

    const VALID_STATUSES = new Set(['draft', 'reviewed', 'needs_update']);
    const rawStatus = typeof data.status === 'string' ? data.status : undefined;
    const status: WikiPageStatus | undefined =
      rawStatus && VALID_STATUSES.has(rawStatus) ? (rawStatus as WikiPageStatus) : undefined;
    const source_count = typeof data.source_count === 'number' ? data.source_count : undefined;

    return {
      title,
      type,
      tags,
      sources,
      content: content.trim(),
      wikilinks,
      created,
      updated,
      filePath,
      source_count,
      status,
    };
  } catch (err) {
    log.error({ filePath, err }, 'Failed to parse wiki page');
    return null;
  }
}

/**
 * Serialize a WikiPage back to Markdown with YAML frontmatter.
 */
export function serializeWikiPage(page: WikiPage): string {
  const frontmatter: Record<string, unknown> = {
    title: page.title,
    type: page.type,
    tags: page.tags,
    sources: page.sources,
    source_count: page.source_count ?? page.sources.length,
    status: page.status ?? 'draft',
    created: page.created,
    updated: page.updated,
  };

  return matter.stringify(page.content, frontmatter);
}

/**
 * Validate a WikiPage for structural correctness.
 *
 * @returns Array of validation error messages (empty = valid)
 */
export function validateWikiPage(page: WikiPage): string[] {
  const errors: string[] = [];

  if (!page.title || page.title.trim().length === 0) {
    errors.push('Page is missing a title');
  }

  if (!VALID_TYPES.has(page.type)) {
    errors.push(`Invalid page type: ${page.type}`);
  }

  if (!page.content || page.content.trim().length === 0) {
    errors.push('Page has no content');
  }

  // Check for broken wikilinks (self-referential)
  if (page.title && page.wikilinks.includes(page.title)) {
    errors.push(`Page contains self-referential wikilink: [[${page.title}]]`);
  }

  return errors;
}
