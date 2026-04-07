/**
 * Query CLI — command-line interface for querying the compiled wiki.
 *
 * Usage:
 *   bun run src/wiki-agent/query/cli.ts -- "What is the API architecture?"
 *   bun run src/wiki-agent/query/cli.ts -- --wiki-dir ./wiki "How does auth work?"
 *   bun run src/wiki-agent/query/cli.ts -- --max-pages 3 --json "Query text"
 */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { executeQuery } from './engine.ts';
import { createFTS5Storage } from '../wiki/fts5-storage.ts';
import { createLLMProvider } from '../../providers/llm.ts';
import { loadConfig } from '../../config.ts';
import { createLogger } from '../../logger.ts';
import type { Query } from '../../types.ts';

const log = createLogger('query-cli');

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      'wiki-dir': { type: 'string', short: 'w' },
      'db-path': { type: 'string' },
      'max-pages': { type: 'string', short: 'k' },
      model: { type: 'string', short: 'm' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
wiki-vs-rag Query CLI — Ask questions against the compiled wiki.

Usage:
  bun run src/wiki-agent/query/cli.ts -- "Your question here"

Options:
  --wiki-dir, -w    Wiki directory to query (default: ./wiki)
  --db-path         Path to SQLite database file (default: re-index from wiki-dir)
  --max-pages, -k   Maximum pages to retrieve for context (default: 5)
  --model, -m       LLM model to use for synthesis
  --json            Output result as JSON
  --help, -h        Show this help message
`);
    process.exit(0);
  }

  const questionText = positionals.join(' ').trim();

  if (!questionText) {
    console.error('Error: Please provide a question as a positional argument.');
    console.error('Usage: bun run src/wiki-agent/query/cli.ts -- "Your question"');
    process.exit(1);
  }

  const config = loadConfig();

  const wikiDir = resolve(values['wiki-dir'] ?? config.wikiDir);
  const dbPath = values['db-path'] ?? ':memory:';
  const maxPages = values['max-pages'] ? parseInt(values['max-pages'], 10) : 5;
  const model = values.model ?? config.compileModel;
  const outputJson = !!values.json;

  // Create storage and re-index from disk
  const storage = createFTS5Storage(dbPath);
  const pageCount = await storage.reindexFromDisk(wikiDir);

  if (pageCount === 0) {
    console.log('⚠️  No wiki pages found. Run ingest first.');
    storage.close();
    process.exit(1);
  }

  if (!outputJson) {
    console.log(`📚 Loaded ${pageCount} wiki pages`);
    console.log(`❓ Question: ${questionText}\n`);
  }

  // Create query
  const query: Query = {
    id: uuidv4(),
    text: questionText,
  };

  // Create LLM provider
  const llm = createLLMProvider(config.llmProvider, config.openaiApiKey);

  // Execute query
  const answer = await executeQuery(query, storage, llm, { maxPages, model });

  if (outputJson) {
    console.log(JSON.stringify(answer, null, 2));
  } else {
    console.log(`💬 Answer:`);
    console.log(`   ${answer.text}\n`);

    if (answer.citations.length > 0) {
      console.log(`📎 Citations (${answer.citations.length}):`);
      for (const citation of answer.citations) {
        const relevanceStr = citation.relevance ? ` (relevance: ${(citation.relevance * 100).toFixed(0)}%)` : '';
        console.log(`   • [[${citation.source}]]${relevanceStr}`);
        if (citation.excerpt) {
          console.log(`     "${citation.excerpt.slice(0, 100)}..."`);
        }
      }
      console.log();
    }

    console.log(`⏱️  Latency: ${answer.latencyMs}ms`);
    if (answer.tokenUsage) {
      console.log(`📊 Tokens: ${answer.tokenUsage.totalTokens} (prompt: ${answer.tokenUsage.promptTokens}, completion: ${answer.tokenUsage.completionTokens})`);
    }
  }

  storage.close();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
