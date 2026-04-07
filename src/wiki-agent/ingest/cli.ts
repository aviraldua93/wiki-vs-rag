/**
 * Ingest CLI — command-line interface for the wiki compilation pipeline.
 *
 * Accepts --dir flag pointing to a corpus directory, loads documents,
 * compiles them into wiki pages via LLM, and writes output to wiki/.
 *
 * Usage:
 *   bun run src/wiki-agent/ingest/cli.ts -- --dir corpus/
 *   bun run src/wiki-agent/ingest/cli.ts -- --dir corpus/ --no-disk
 *   bun run src/wiki-agent/ingest/cli.ts -- --dir corpus/ --wiki-dir ./wiki
 */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { loadCorpus } from '../../corpus/loader.ts';
import { runIngestPipeline } from './pipeline.ts';
import { generateIndexPage, generateOverviewPage } from './generators.ts';
import { createFTS5Storage } from '../wiki/fts5-storage.ts';
import { createLLMProvider } from '../../providers/llm.ts';
import { loadConfig } from '../../config.ts';
import { createLogger } from '../../logger.ts';

const log = createLogger('ingest-cli');

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string', short: 'd' },
      'wiki-dir': { type: 'string', short: 'w' },
      'no-disk': { type: 'boolean', default: false },
      model: { type: 'string', short: 'm' },
      'db-path': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`
wiki-vs-rag Ingest CLI — Compile corpus documents into wiki pages.

Usage:
  bun run src/wiki-agent/ingest/cli.ts -- --dir <corpus-dir>

Options:
  --dir, -d       Corpus directory to ingest (required)
  --wiki-dir, -w  Output directory for wiki pages (default: ./wiki)
  --no-disk       Skip writing files to disk (index only)
  --model, -m     LLM model to use for compilation
  --db-path       Path to SQLite database file (default: :memory:)
  --help, -h      Show this help message
`);
    process.exit(0);
  }

  const config = loadConfig();

  const corpusDir = values.dir ?? config.corpusDir;
  const wikiDir = values['wiki-dir'] ?? config.wikiDir;
  const writeToDisk = !values['no-disk'];
  const model = values.model ?? config.compileModel;
  const dbPath = values['db-path'] ?? ':memory:';

  if (!corpusDir) {
    console.error('Error: --dir flag is required. Use --help for usage info.');
    process.exit(1);
  }

  const resolvedCorpusDir = resolve(corpusDir);
  const resolvedWikiDir = resolve(wikiDir);

  console.log(`📚 Loading corpus from: ${resolvedCorpusDir}`);
  const documents = await loadCorpus(resolvedCorpusDir);

  if (documents.length === 0) {
    console.error('❌ No documents found in corpus directory.');
    process.exit(1);
  }

  console.log(`📄 Found ${documents.length} documents`);

  // Create providers
  const llm = createLLMProvider(config.llmProvider, config.openaiApiKey);
  const storage = createFTS5Storage(dbPath);

  console.log(`🔧 Using LLM provider: ${llm.name} (model: ${model})`);
  console.log(`📁 Wiki output: ${resolvedWikiDir}`);

  // Run the ingest pipeline
  const results = await runIngestPipeline(documents, llm, storage, {
    wikiDir: resolvedWikiDir,
    writeToDisk,
    model,
  });

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  // Generate index.md and overview.md
  if (writeToDisk) {
    const pages = results
      .filter((r) => r.success && r.page)
      .map((r) => r.page!);

    await generateIndexPage(pages, resolvedWikiDir);
    await generateOverviewPage(pages, resolvedWikiDir);
    console.log('📋 Generated index.md and overview.md');
  }

  // Print summary
  console.log(`\n✅ Ingest complete:`);
  console.log(`   Succeeded: ${succeeded}/${documents.length}`);
  if (failed > 0) {
    console.log(`   Failed: ${failed}`);
    for (const r of results.filter((r) => !r.success)) {
      console.log(`   ❌ ${r.documentId}: ${r.error}`);
    }
  }
  console.log(`   Pages indexed: ${storage.getPageCount()}`);

  storage.close();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
