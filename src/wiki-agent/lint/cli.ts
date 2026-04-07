/**
 * Lint CLI — command-line interface for wiki structural + semantic validation.
 *
 * Usage:
 *   bun run src/wiki-agent/lint/cli.ts
 *   bun run src/wiki-agent/lint/cli.ts -- --wiki-dir ./wiki
 *   bun run src/wiki-agent/lint/cli.ts -- --corpus-dir ./corpus --no-semantic
 */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { runLint } from './engine.ts';
import { createFTS5Storage } from '../wiki/fts5-storage.ts';
import { createLLMProvider } from '../../providers/llm.ts';
import { loadConfig } from '../../config.ts';
import { createLogger } from '../../logger.ts';

const log = createLogger('lint-cli');

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'wiki-dir': { type: 'string', short: 'w' },
      'corpus-dir': { type: 'string', short: 'c' },
      'db-path': { type: 'string' },
      'no-semantic': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`
wiki-vs-rag Lint CLI — Validate and lint compiled wiki pages.

Usage:
  bun run src/wiki-agent/lint/cli.ts

Options:
  --wiki-dir, -w    Wiki directory to lint (default: ./wiki)
  --corpus-dir, -c  Corpus directory for stale page detection
  --db-path         Path to SQLite database file (default: re-index from wiki-dir)
  --no-semantic     Skip LLM-based semantic checks
  --json            Output results as JSON
  --help, -h        Show this help message
`);
    process.exit(0);
  }

  const config = loadConfig();

  const wikiDir = resolve(values['wiki-dir'] ?? config.wikiDir);
  const corpusDir = values['corpus-dir'] ? resolve(values['corpus-dir']) : undefined;
  const dbPath = values['db-path'] ?? ':memory:';
  const runSemantic = !values['no-semantic'];
  const outputJson = !!values.json;

  console.log(`🔍 Linting wiki at: ${wikiDir}`);

  // Create storage and re-index from disk
  const storage = createFTS5Storage(dbPath);
  const pageCount = await storage.reindexFromDisk(wikiDir);

  if (pageCount === 0) {
    console.log('⚠️  No wiki pages found to lint.');
    storage.close();
    process.exit(0);
  }

  console.log(`📄 Found ${pageCount} pages to lint`);

  // Create LLM provider
  const llm = createLLMProvider(config.llmProvider, config.openaiApiKey);

  // Run lint
  const result = await runLint(storage, llm, {
    corpusDir,
    semantic: runSemantic,
  });

  if (outputJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    // Pretty-print results
    console.log(`\n📊 Lint Results:`);
    console.log(`   Pages checked: ${result.pagesChecked}`);
    console.log(`   Pages with issues: ${result.pagesWithIssues}`);
    console.log(`   Score: ${(result.score * 100).toFixed(1)}%\n`);

    if (result.issues.length === 0) {
      console.log('✅ No issues found!');
    } else {
      // Group by severity
      const errors = result.issues.filter((i) => i.severity === 'error');
      const warnings = result.issues.filter((i) => i.severity === 'warning');
      const infos = result.issues.filter((i) => i.severity === 'info');

      if (errors.length > 0) {
        console.log(`❌ Errors (${errors.length}):`);
        for (const issue of errors) {
          console.log(`   [${issue.page}] ${issue.message}`);
        }
        console.log();
      }

      if (warnings.length > 0) {
        console.log(`⚠️  Warnings (${warnings.length}):`);
        for (const issue of warnings) {
          console.log(`   [${issue.page}] ${issue.message}`);
        }
        console.log();
      }

      if (infos.length > 0) {
        console.log(`ℹ️  Info (${infos.length}):`);
        for (const issue of infos) {
          console.log(`   [${issue.page}] ${issue.message}`);
        }
        console.log();
      }
    }

    if (result.suggestions.length > 0) {
      console.log(`💡 Suggestions (${result.suggestions.length}):`);
      for (const suggestion of result.suggestions.slice(0, 20)) {
        console.log(`   ${suggestion}`);
      }
      if (result.suggestions.length > 20) {
        console.log(`   ... and ${result.suggestions.length - 20} more`);
      }
    }
  }

  storage.close();

  // Exit with non-zero if there are errors
  const errorCount = result.issues.filter((i) => i.severity === 'error').length;
  if (errorCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
