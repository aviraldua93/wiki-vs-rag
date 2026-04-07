/**
 * Corpus document loader.
 *
 * Recursively loads .md and .txt files from the corpus directory,
 * tagging each with its category based on parent directory name.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, basename, extname, dirname } from 'node:path';
import matter from 'gray-matter';
import type { CorpusDocument, CorpusCategory } from '../types.ts';
import { createLogger } from '../logger.ts';

const log = createLogger('corpus-loader');

/** Valid corpus categories matching directory names. */
const VALID_CATEGORIES: Set<string> = new Set([
  'technical',
  'narrative',
  'multi-doc',
  'evolving',
]);

/** Supported file extensions for corpus documents. */
const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt']);

/**
 * Determine the corpus category from a file's relative path.
 * The category is the first directory component if it matches a known category.
 */
function resolveCategory(relativePath: string): CorpusCategory | null {
  // Normalize path separators
  const normalized = relativePath.replace(/\\/g, '/');
  const firstDir = normalized.split('/')[0];
  if (firstDir && VALID_CATEGORIES.has(firstDir)) {
    return firstDir as CorpusCategory;
  }
  return null;
}

/**
 * Generate a document ID from the relative file path.
 * Strips extension and replaces separators with dashes.
 */
function generateId(relativePath: string): string {
  return relativePath
    .replace(/\\/g, '/')
    .replace(/\.(md|txt)$/, '')
    .replace(/[\/\\]/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

/**
 * Extract title from document content.
 * Prefers frontmatter title, then first H1 heading, then filename.
 */
function extractTitle(
  content: string,
  metadata: Record<string, unknown>,
  filePath: string,
): string {
  // From frontmatter
  if (metadata.title && typeof metadata.title === 'string') {
    return metadata.title;
  }

  // From first H1 heading
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    return h1Match[1].trim();
  }

  // From filename
  return basename(filePath, extname(filePath))
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Recursively collect all file paths with supported extensions.
 */
async function collectFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      log.warn({ dir }, 'Directory does not exist');
      return results;
    }
    throw err;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectFiles(fullPath);
      results.push(...nested);
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(ext) && !entry.name.startsWith('.')) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * Load a single file into a CorpusDocument.
 */
async function loadDocument(
  filePath: string,
  corpusDir: string,
): Promise<CorpusDocument | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const fileStat = await stat(filePath);
    const relPath = relative(corpusDir, filePath);
    const category = resolveCategory(relPath);

    if (!category) {
      log.warn(
        { filePath, relPath },
        'File not in a recognized category directory; skipping',
      );
      return null;
    }

    // Parse frontmatter (if present)
    let content: string;
    let metadata: Record<string, unknown>;
    try {
      const parsed = matter(raw);
      content = parsed.content;
      metadata = parsed.data as Record<string, unknown>;
    } catch {
      // Not a frontmatter file — use raw content
      content = raw;
      metadata = {};
    }

    const title = extractTitle(content, metadata, filePath);
    const id = generateId(relPath);

    return {
      id,
      title,
      content,
      filePath,
      relativePath: relPath.replace(/\\/g, '/'),
      category,
      metadata,
      sizeBytes: fileStat.size,
    };
  } catch (err) {
    log.error({ filePath, err }, 'Failed to load document');
    return null;
  }
}

/**
 * Load all corpus documents from the specified directory.
 *
 * @param corpusDir - Root directory of the corpus (e.g., './corpus')
 * @returns Array of loaded CorpusDocument objects
 *
 * @example
 * ```ts
 * import { loadCorpus } from './corpus/loader.ts';
 * const docs = await loadCorpus('./corpus');
 * console.log(`Loaded ${docs.length} documents`);
 * ```
 */
export async function loadCorpus(corpusDir: string): Promise<CorpusDocument[]> {
  log.info({ corpusDir }, 'Loading corpus documents');

  const files = await collectFiles(corpusDir);

  if (files.length === 0) {
    log.warn({ corpusDir }, 'No documents found in corpus directory');
    return [];
  }

  log.info({ fileCount: files.length }, 'Found corpus files');

  const results = await Promise.all(
    files.map((f) => loadDocument(f, corpusDir)),
  );

  const documents = results.filter((d): d is CorpusDocument => d !== null);

  // Log summary by category
  const byCat = new Map<string, number>();
  for (const doc of documents) {
    byCat.set(doc.category, (byCat.get(doc.category) ?? 0) + 1);
  }
  log.info(
    { totalDocs: documents.length, byCategory: Object.fromEntries(byCat) },
    'Corpus loaded',
  );

  return documents;
}

/**
 * Get all unique categories found in a set of documents.
 */
export function getCategories(documents: CorpusDocument[]): CorpusCategory[] {
  return [...new Set(documents.map((d) => d.category))];
}

/**
 * Filter documents by category.
 */
export function filterByCategory(
  documents: CorpusDocument[],
  category: CorpusCategory,
): CorpusDocument[] {
  return documents.filter((d) => d.category === category);
}
