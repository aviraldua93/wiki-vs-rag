/**
 * FTS5 full-text search storage for wiki pages.
 *
 * Uses Bun's built-in SQLite with FTS5 extension for fast wiki page search.
 * Provides CRUD operations, FTS5 search with BM25 ranking, wikilink resolution,
 * backlink tracking, orphan detection, and disk re-indexing.
 */

import { Database } from 'bun:sqlite';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import type { WikiPage, WikiPageType } from '../../types.ts';
import { parseWikiPage } from './page.ts';
import { createLogger } from '../../logger.ts';

const log = createLogger('fts5-storage');

/**
 * Search result from FTS5 query.
 */
export interface SearchResult {
  /** Page title */
  title: string;
  /** Page file path */
  filePath: string;
  /** Content snippet with matches highlighted */
  snippet: string;
  /** BM25 relevance rank (lower = more relevant) */
  rank: number;
}

/**
 * Result of resolving a [[wikilink]] target.
 */
export interface WikilinkResolution {
  /** Whether the target page exists */
  exists: boolean;
  /** Page title (as given) */
  target: string;
  /** File path of the resolved page (if it exists) */
  filePath?: string;
  /** Page type (if it exists) */
  type?: WikiPageType;
  /** Page tags (if it exists) */
  tags?: string[];
}

/**
 * FTS5-based wiki page storage and search engine.
 */
export class WikiFTS5Storage {
  private db: Database;
  private initialized = false;

  /**
   * Create a new FTS5 storage instance.
   *
   * @param dbPath - Path to SQLite database file, or ':memory:' for in-memory
   */
  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.init();
  }

  /** Initialize the database schema. */
  private init(): void {
    if (this.initialized) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wiki_pages (
        title TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        sources TEXT NOT NULL DEFAULT '[]',
        content TEXT NOT NULL,
        wikilinks TEXT NOT NULL DEFAULT '[]',
        created TEXT NOT NULL,
        updated TEXT NOT NULL,
        file_path TEXT
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS wiki_fts USING fts5(
        title,
        content,
        tags,
        content=wiki_pages,
        content_rowid=rowid,
        tokenize='porter unicode61'
      );

      CREATE TRIGGER IF NOT EXISTS wiki_pages_ai AFTER INSERT ON wiki_pages BEGIN
        INSERT INTO wiki_fts(rowid, title, content, tags)
        VALUES (new.rowid, new.title, new.content, new.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS wiki_pages_ad AFTER DELETE ON wiki_pages BEGIN
        INSERT INTO wiki_fts(wiki_fts, rowid, title, content, tags)
        VALUES ('delete', old.rowid, old.title, old.content, old.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS wiki_pages_au AFTER UPDATE ON wiki_pages BEGIN
        INSERT INTO wiki_fts(wiki_fts, rowid, title, content, tags)
        VALUES ('delete', old.rowid, old.title, old.content, old.tags);
        INSERT INTO wiki_fts(rowid, title, content, tags)
        VALUES (new.rowid, new.title, new.content, new.tags);
      END;
    `);

    this.initialized = true;
    log.info('FTS5 storage initialized');
  }

  // ── CRUD Operations ────────────────────────────────────────────

  /**
   * Create a new wiki page. Throws if page already exists.
   */
  createPage(page: WikiPage): void {
    const existing = this.getPage(page.title);
    if (existing) {
      throw new Error(`Page already exists: ${page.title}`);
    }
    this.upsertPage(page);
    log.debug({ title: page.title }, 'Page created');
  }

  /**
   * Update an existing wiki page. Throws if page doesn't exist.
   */
  updatePage(page: WikiPage): void {
    const existing = this.getPage(page.title);
    if (!existing) {
      throw new Error(`Page not found: ${page.title}`);
    }
    this.upsertPage(page);
    log.debug({ title: page.title }, 'Page updated');
  }

  /**
   * Index a wiki page (insert or update).
   */
  upsertPage(page: WikiPage): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO wiki_pages (title, type, tags, sources, content, wikilinks, created, updated, file_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      page.title,
      page.type,
      JSON.stringify(page.tags),
      JSON.stringify(page.sources),
      page.content,
      JSON.stringify(page.wikilinks),
      page.created,
      page.updated,
      page.filePath ?? null,
    );

    log.debug({ title: page.title }, 'Page indexed');
  }

  /**
   * Index multiple pages in a single transaction.
   */
  upsertPages(pages: WikiPage[]): void {
    const tx = this.db.transaction(() => {
      for (const page of pages) {
        this.upsertPage(page);
      }
    });
    tx();
    log.info({ count: pages.length }, 'Batch indexed pages');
  }

  /**
   * Get a wiki page by title.
   */
  getPage(title: string): WikiPage | null {
    const row = this.db.prepare(
      'SELECT * FROM wiki_pages WHERE title = ?',
    ).get(title) as any;

    if (!row) return null;

    return {
      title: row.title,
      type: row.type,
      tags: JSON.parse(row.tags),
      sources: JSON.parse(row.sources),
      content: row.content,
      wikilinks: JSON.parse(row.wikilinks),
      created: row.created,
      updated: row.updated,
      filePath: row.file_path,
    };
  }

  /**
   * Delete a page by title.
   */
  deletePage(title: string): boolean {
    const result = this.db.run('DELETE FROM wiki_pages WHERE title = ?', [title]);
    return result.changes > 0;
  }

  // ── Search ─────────────────────────────────────────────────────

  /**
   * Full-text search across wiki pages with BM25 relevance ranking.
   *
   * @param query - Search query text (special FTS5 chars are stripped)
   * @param limit - Maximum results to return
   * @returns Array of search results ordered by relevance
   */
  search(query: string, limit: number = 10): SearchResult[] {
    if (!query.trim()) return [];

    // Sanitize query: strip FTS5 special characters to avoid syntax errors
    const sanitized = query
      .replace(/[?!@#$%^&*()+={}\[\]|\\:;"'<>,./~`]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!sanitized) return [];

    try {
      const stmt = this.db.prepare(`
        SELECT
          p.title,
          p.file_path as filePath,
          snippet(wiki_fts, 1, '<mark>', '</mark>', '...', 32) as snippet,
          rank
        FROM wiki_fts
        JOIN wiki_pages p ON wiki_fts.rowid = p.rowid
        WHERE wiki_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `);

      return stmt.all(sanitized, limit) as SearchResult[];
    } catch (err) {
      log.error({ query: sanitized, err }, 'FTS5 search failed');
      return [];
    }
  }

  /**
   * Alias for search — searches pages by query with relevance ranking.
   */
  searchPages(query: string, limit: number = 10): SearchResult[] {
    return this.search(query, limit);
  }

  // ── Wikilink Resolution ────────────────────────────────────────

  /**
   * Resolve a [[wikilink]] target to its page metadata.
   *
   * @param target - The wikilink target text (page title)
   * @returns Resolution result with existence, file path, and metadata
   */
  resolveWikilink(target: string): WikilinkResolution {
    const page = this.getPage(target);

    if (!page) {
      return { exists: false, target };
    }

    return {
      exists: true,
      target,
      filePath: page.filePath,
      type: page.type,
      tags: page.tags,
    };
  }

  /**
   * Resolve multiple wikilink targets at once.
   */
  resolveWikilinks(targets: string[]): WikilinkResolution[] {
    return targets.map((t) => this.resolveWikilink(t));
  }

  /**
   * Get all broken wikilinks across all pages (targets that don't exist).
   */
  getBrokenWikilinks(): Array<{ page: string; target: string }> {
    const allTitles = new Set(this.getAllTitles());
    const broken: Array<{ page: string; target: string }> = [];

    for (const title of allTitles) {
      const page = this.getPage(title);
      if (!page) continue;
      for (const link of page.wikilinks) {
        if (!allTitles.has(link)) {
          broken.push({ page: title, target: link });
        }
      }
    }

    return broken;
  }

  // ── Metadata Queries ───────────────────────────────────────────

  /**
   * Get all indexed page titles.
   */
  getAllTitles(): string[] {
    const rows = this.db.prepare('SELECT title FROM wiki_pages ORDER BY title').all() as any[];
    return rows.map((r: any) => r.title);
  }

  /**
   * Get all pages of a given type.
   */
  getPagesByType(type: WikiPageType): WikiPage[] {
    const rows = this.db.prepare('SELECT * FROM wiki_pages WHERE type = ? ORDER BY title').all(type) as any[];
    return rows.map((r: any) => ({
      title: r.title,
      type: r.type,
      tags: JSON.parse(r.tags),
      sources: JSON.parse(r.sources),
      content: r.content,
      wikilinks: JSON.parse(r.wikilinks),
      created: r.created,
      updated: r.updated,
      filePath: r.file_path,
    }));
  }

  /**
   * Get total number of indexed pages.
   */
  getPageCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM wiki_pages').get() as any;
    return row.count;
  }

  /**
   * Find pages that link to a given title (backlinks).
   */
  getBacklinks(title: string): string[] {
    const rows = this.db.prepare(
      "SELECT title FROM wiki_pages WHERE wikilinks LIKE ?",
    ).all(`%"${title}"%`) as any[];
    return rows.map((r: any) => r.title);
  }

  /**
   * Find orphan pages (no incoming links from other pages).
   */
  getOrphanPages(): string[] {
    const allTitles = this.getAllTitles();
    return allTitles.filter((title) => {
      const backlinks = this.getBacklinks(title);
      return backlinks.length === 0;
    });
  }

  // ── Re-indexing ────────────────────────────────────────────────

  /**
   * Rebuild the FTS5 index from wiki/ directory contents.
   * Idempotent — can be called repeatedly without side effects.
   *
   * @param wikiDir - Root directory of the wiki files
   * @returns Number of pages indexed
   */
  async reindexFromDisk(wikiDir: string): Promise<number> {
    log.info({ wikiDir }, 'Re-indexing from disk');

    const files = await this.collectWikiFiles(wikiDir);
    let indexed = 0;

    // Clear existing data
    this.db.run('DELETE FROM wiki_pages');

    const tx = this.db.transaction(() => {
      for (const { filePath, relativePath, raw } of files) {
        const page = parseWikiPage(raw, relativePath);
        if (page) {
          this.upsertPage(page);
          indexed++;
        } else {
          log.warn({ filePath }, 'Failed to parse wiki file during re-index');
        }
      }
    });
    tx();

    log.info({ indexed, total: files.length }, 'Re-index complete');
    return indexed;
  }

  /**
   * Recursively collect all .md files from a directory.
   */
  private async collectWikiFiles(
    dir: string,
    baseDir?: string,
  ): Promise<Array<{ filePath: string; relativePath: string; raw: string }>> {
    const base = baseDir ?? dir;
    const results: Array<{ filePath: string; relativePath: string; raw: string }> = [];

    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return results;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await this.collectWikiFiles(fullPath, base);
        results.push(...nested);
      } else if (entry.isFile() && extname(entry.name) === '.md') {
        try {
          const raw = await readFile(fullPath, 'utf-8');
          const relPath = relative(base, fullPath).replace(/\\/g, '/');
          results.push({ filePath: fullPath, relativePath: relPath, raw });
        } catch (err) {
          log.warn({ fullPath, err }, 'Failed to read wiki file');
        }
      }
    }

    return results;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
    log.info('FTS5 storage closed');
  }
}

/**
 * Create a WikiFTS5Storage instance.
 *
 * @param dbPath - Path to SQLite file, or ':memory:' for testing
 */
export function createFTS5Storage(dbPath: string = ':memory:'): WikiFTS5Storage {
  return new WikiFTS5Storage(dbPath);
}
