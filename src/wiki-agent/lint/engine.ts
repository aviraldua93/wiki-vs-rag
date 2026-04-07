/**
 * Wiki lint engine — structural and semantic validation of wiki pages.
 *
 * Structural checks:
 * - Broken wikilinks (targets that don't exist)
 * - Missing frontmatter fields
 * - Orphan pages (no incoming links)
 * - Stale pages (sources updated after last compilation)
 * - Structural validation (empty title, content)
 *
 * Semantic checks (LLM-powered):
 * - Contradictions between pages
 * - Knowledge gaps
 * - Quality issues
 * - Fix suggestions
 */

import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { WikiPage, LLMProvider, ChatMessage } from '../../types.ts';
import type { WikiFTS5Storage } from '../wiki/fts5-storage.ts';
import { validateWikiPage } from '../wiki/page.ts';
import { createLogger } from '../../logger.ts';

const log = createLogger('wiki-lint');

/** A lint issue found during validation. */
export interface LintIssue {
  /** Page title */
  page: string;
  /** Issue severity */
  severity: 'error' | 'warning' | 'info';
  /** Issue category */
  category: 'broken-link' | 'missing-field' | 'orphan' | 'stale' | 'structural' | 'semantic';
  /** Human-readable description */
  message: string;
  /** Suggested fix (if available) */
  suggestion?: string;
}

/** Result of a lint pass. */
export interface LintResult {
  /** All issues found */
  issues: LintIssue[];
  /** Total pages checked */
  pagesChecked: number;
  /** Pages with issues */
  pagesWithIssues: number;
  /** Overall score (0-1, 1 = no issues) */
  score: number;
  /** Fix suggestions aggregated */
  suggestions: string[];
}

/** Options for the lint pass. */
export interface LintOptions {
  /** Root directory of source corpus (for stale page detection) */
  corpusDir?: string;
  /** Whether to run semantic (LLM) checks */
  semantic?: boolean;
}

/** Required frontmatter fields that every page must have. */
const REQUIRED_FIELDS: Array<keyof WikiPage> = ['title', 'type', 'tags', 'sources', 'created', 'updated'];

/**
 * Run structural lint checks on all indexed wiki pages.
 *
 * Checks:
 * - Broken wikilinks
 * - Missing frontmatter fields
 * - Orphan pages
 * - Stale pages
 * - Structural validation
 */
export function lintStructural(
  storage: WikiFTS5Storage,
  options?: LintOptions,
): LintIssue[] {
  const issues: LintIssue[] = [];
  const allTitles = new Set(storage.getAllTitles());

  for (const title of allTitles) {
    const page = storage.getPage(title);
    if (!page) continue;

    // Structural validation
    const validationErrors = validateWikiPage(page);
    for (const err of validationErrors) {
      issues.push({
        page: title,
        severity: 'error',
        category: 'structural',
        message: err,
      });
    }

    // Missing frontmatter fields
    for (const field of REQUIRED_FIELDS) {
      const value = page[field];
      if (value === undefined || value === null || value === '') {
        issues.push({
          page: title,
          severity: 'error',
          category: 'missing-field',
          message: `Missing required frontmatter field: ${field}`,
          suggestion: `Add '${field}' to the page's YAML frontmatter`,
        });
      } else if (Array.isArray(value) && value.length === 0 && field === 'sources') {
        issues.push({
          page: title,
          severity: 'warning',
          category: 'missing-field',
          message: `Empty sources array — page has no source attribution`,
          suggestion: `Add source document references to the 'sources' field`,
        });
      }
    }

    // Broken wikilinks
    for (const link of page.wikilinks) {
      if (!allTitles.has(link)) {
        issues.push({
          page: title,
          severity: 'warning',
          category: 'broken-link',
          message: `Broken wikilink: [[${link}]] — target page does not exist`,
          suggestion: `Create page '${link}' or remove the broken wikilink`,
        });
      }
    }
  }

  // Orphan detection
  const orphans = storage.getOrphanPages();
  for (const orphan of orphans) {
    issues.push({
      page: orphan,
      severity: 'info',
      category: 'orphan',
      message: 'Page has no incoming links from other pages',
      suggestion: `Add [[${orphan}]] wikilink from a related page`,
    });
  }

  return issues;
}

/**
 * Detect stale pages whose source documents have been updated after compilation.
 *
 * @param storage - FTS5 storage instance
 * @param corpusDir - Root directory of the corpus
 * @returns Array of stale page lint issues
 */
export async function lintStalePages(
  storage: WikiFTS5Storage,
  corpusDir: string,
): Promise<LintIssue[]> {
  const issues: LintIssue[] = [];
  const titles = storage.getAllTitles();

  for (const title of titles) {
    const page = storage.getPage(title);
    if (!page || page.sources.length === 0) continue;

    const pageUpdated = new Date(page.updated).getTime();

    for (const source of page.sources) {
      try {
        const sourcePath = join(corpusDir, source);
        const fileStat = await stat(sourcePath);
        const sourceModified = fileStat.mtime.getTime();

        if (sourceModified > pageUpdated) {
          issues.push({
            page: title,
            severity: 'warning',
            category: 'stale',
            message: `Source '${source}' was modified after page was last compiled (source: ${fileStat.mtime.toISOString().split('T')[0]}, page: ${page.updated})`,
            suggestion: `Re-run ingest for source '${source}' to update this page`,
          });
        }
      } catch {
        // Source file doesn't exist or can't be read — skip
      }
    }
  }

  return issues;
}

/**
 * Run semantic lint checks using LLM analysis.
 *
 * Sends page content to the LLM to check for:
 * - Contradictions between pages
 * - Data gaps or incomplete information
 * - Quality issues
 * Returns both issues and fix suggestions.
 */
export async function lintSemantic(
  storage: WikiFTS5Storage,
  llm: LLMProvider,
): Promise<{ issues: LintIssue[]; suggestions: string[] }> {
  const issues: LintIssue[] = [];
  const suggestions: string[] = [];
  const titles = storage.getAllTitles();

  // Collect all page summaries for cross-page contradiction check
  const pageSummaries = titles.map((t) => {
    const p = storage.getPage(t);
    return p ? `[${p.title}] (${p.type}): ${p.content.slice(0, 300)}` : '';
  }).filter(Boolean);

  // Per-page semantic check
  for (const title of titles) {
    const page = storage.getPage(title);
    if (!page) continue;

    // Include summaries of related pages for contradiction detection
    const relatedSummaries = pageSummaries
      .filter((s) => !s.startsWith(`[${title}]`))
      .slice(0, 5)
      .join('\n\n');

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are a wiki content validator. Lint the following wiki page and check for:
1. Contradictions with other pages in the knowledge base
2. Knowledge gaps or incomplete information
3. Quality issues (clarity, accuracy, organization)
4. Suggestions for improvement

Other pages in the knowledge base for contradiction checking:
${relatedSummaries}

Return JSON: { "issues": [string], "suggestions": [string], "score": number }`,
      },
      {
        role: 'user',
        content: `Lint this wiki page:\n\nTitle: ${page.title}\nType: ${page.type}\nTags: ${page.tags.join(', ')}\n\n${page.content}`,
      },
    ];

    try {
      const response = await llm.complete(messages, { responseFormat: 'json' });
      const parsed = JSON.parse(response.content);

      if (Array.isArray(parsed.issues)) {
        for (const issue of parsed.issues) {
          issues.push({
            page: title,
            severity: 'warning',
            category: 'semantic',
            message: String(issue),
          });
        }
      }

      if (Array.isArray(parsed.suggestions)) {
        for (const suggestion of parsed.suggestions) {
          suggestions.push(`[${title}] ${String(suggestion)}`);
        }
      }
    } catch (err) {
      log.warn({ title, err }, 'Semantic lint failed for page');
    }
  }

  return { issues, suggestions };
}

/**
 * Run full lint pass (structural + semantic + stale).
 */
export async function runLint(
  storage: WikiFTS5Storage,
  llm: LLMProvider,
  options?: LintOptions,
): Promise<LintResult> {
  log.info('Starting lint pass');

  const structuralIssues = lintStructural(storage, options);

  // Stale page detection
  let staleIssues: LintIssue[] = [];
  if (options?.corpusDir) {
    staleIssues = await lintStalePages(storage, options.corpusDir);
  }

  // Semantic lint (optional, defaults to true)
  let semanticResult = { issues: [] as LintIssue[], suggestions: [] as string[] };
  if (options?.semantic !== false) {
    semanticResult = await lintSemantic(storage, llm);
  }

  const allIssues = [...structuralIssues, ...staleIssues, ...semanticResult.issues];
  const pagesChecked = storage.getPageCount();
  const pagesWithIssues = new Set(allIssues.map((i) => i.page)).size;

  const errorCount = allIssues.filter((i) => i.severity === 'error').length;
  const warningCount = allIssues.filter((i) => i.severity === 'warning').length;
  // Score: penalize errors heavily, warnings moderately
  const maxScore = Math.max(pagesChecked, 1);
  const score = Math.max(0, 1 - (errorCount * 0.2 + warningCount * 0.05) / maxScore);

  // Aggregate fix suggestions from both structural and semantic
  const allSuggestions = [
    ...allIssues.filter((i) => i.suggestion).map((i) => `[${i.page}] ${i.suggestion}`),
    ...semanticResult.suggestions,
  ];

  const result: LintResult = {
    issues: allIssues,
    pagesChecked,
    pagesWithIssues,
    score,
    suggestions: allSuggestions,
  };

  log.info(
    { pagesChecked, issueCount: allIssues.length, score: result.score },
    'Lint pass complete',
  );

  return result;
}
