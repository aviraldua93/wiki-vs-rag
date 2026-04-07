/**
 * Wiki query engine — answers questions from compiled wiki knowledge.
 *
 * Flow: question → FTS5 search → select relevant pages → LLM synthesis → answer with citations
 */

import type {
  Query,
  Answer,
  Citation,
  LLMProvider,
  ChatMessage,
  WikiPage,
} from '../../types.ts';
import type { WikiFTS5Storage, SearchResult } from '../wiki/fts5-storage.ts';
import { serializeWikiPage } from '../wiki/page.ts';
import { createLogger } from '../../logger.ts';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const log = createLogger('query-engine');

/** Options for query execution. */
export interface QueryOptions {
  /** Maximum pages to retrieve for context */
  maxPages?: number;
  /** Model to use for synthesis */
  model?: string;
  /** If set, file the answer back as a synthesis page in this wiki directory */
  fileBackDir?: string;
}

const DEFAULT_OPTIONS: Required<QueryOptions> = {
  maxPages: 5,
  model: 'gpt-4o-mini',
  fileBackDir: '',
};

/**
 * Build the synthesis prompt from question and context pages.
 */
function buildSynthesisPrompt(
  query: Query,
  pages: WikiPage[],
): ChatMessage[] {
  const contextParts = pages.map((p, i) =>
    `--- Page ${i + 1}: ${p.title} (${p.filePath ?? 'unknown'}) ---\n${p.content}`
  );

  return [
    {
      role: 'system',
      content: `You are a knowledge base assistant. Answer the question using ONLY the provided wiki pages as context. Cite your sources using [[PageTitle]] wikilink notation. If the context does not contain enough information to answer, say so explicitly.`,
    },
    {
      role: 'user',
      content: `Context wiki pages:\n\n${contextParts.join('\n\n')}\n\nQuestion: ${query.text}`,
    },
  ];
}

/**
 * Extract [[citations]] from an answer text.
 */
function extractCitations(answerText: string, pages: WikiPage[]): Citation[] {
  const citedTitles = new Set<string>();
  const regex = /\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(answerText)) !== null) {
    citedTitles.add(match[1].trim());
  }

  return Array.from(citedTitles).map((title) => {
    const page = pages.find((p) => p.title === title);
    return {
      source: title,
      excerpt: page ? page.content.slice(0, 200) : undefined,
      relevance: page ? 0.9 : 0.5,
    };
  });
}

/**
 * Execute a query against the wiki knowledge base.
 *
 * @param query - The question to answer
 * @param storage - FTS5 storage with indexed wiki pages
 * @param llm - LLM provider for synthesis
 * @param options - Query execution options
 * @returns Answer with citations and metadata
 */
export async function executeQuery(
  query: Query,
  storage: WikiFTS5Storage,
  llm: LLMProvider,
  options?: QueryOptions,
): Promise<Answer> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();

  log.info({ queryId: query.id, text: query.text }, 'Executing query');

  // Step 1: Search for relevant pages
  const searchResults = storage.search(query.text, opts.maxPages);

  // Step 2: Load full pages
  const pages: WikiPage[] = [];
  for (const result of searchResults) {
    const page = storage.getPage(result.title);
    if (page) pages.push(page);
  }

  // If no pages found, return a "no context" answer
  if (pages.length === 0) {
    return {
      queryId: query.id,
      text: 'I could not find relevant information in the knowledge base to answer this question.',
      citations: [],
      system: 'wiki',
      latencyMs: Date.now() - startTime,
    };
  }

  // Step 3: Synthesize answer with LLM
  const messages = buildSynthesisPrompt(query, pages);
  const response = await llm.complete(messages, { model: opts.model });

  // Step 4: Extract citations
  const citations = extractCitations(response.content, pages);

  const answer: Answer = {
    queryId: query.id,
    text: response.content,
    citations,
    system: 'wiki',
    latencyMs: Date.now() - startTime,
    tokenUsage: response.tokenUsage,
  };

  log.info(
    { queryId: query.id, latencyMs: answer.latencyMs, citationCount: citations.length },
    'Query completed',
  );

  // Compounding loop: file answer back as a synthesis page (Karpathy method)
  if (opts.fileBackDir) {
    try {
      const slug = query.id.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
      const synthesisPage: WikiPage = {
        title: `Answer: ${query.text.slice(0, 80)}`,
        type: 'synthesis',
        tags: ['query-answer', 'auto-generated'],
        sources: citations.map((c) => c.source),
        source_count: citations.length,
        status: 'draft',
        content: `# ${query.text}\n\n${response.content}`,
        wikilinks: citations.map((c) => c.source),
        created: new Date().toISOString().split('T')[0],
        updated: new Date().toISOString().split('T')[0],
        filePath: `syntheses/${slug}.md`,
      };
      storage.upsertPage(synthesisPage);

      const outPath = join(opts.fileBackDir, `syntheses/${slug}.md`);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, serializeWikiPage(synthesisPage), 'utf-8');
      log.info({ queryId: query.id, outPath }, 'Filed answer back as synthesis page');
    } catch (err) {
      log.warn({ queryId: query.id, err }, 'Failed to file answer back');
    }
  }

  return answer;
}
