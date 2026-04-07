/**
 * Benchmark CLI — entry point for running benchmarks.
 *
 * Usage:
 *   bun run benchmark                     # Run with test queries
 *   bun run benchmark -- --dataset path   # Run with custom Q&A dataset
 *   bun run benchmark:report              # Show latest results
 */

import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { runBenchmark } from './runner.ts';
import type { BenchmarkRunResult } from './runner.ts';
import { generateReport, renderReportTable, saveReport, loadBenchmarkRun, findLatestRun } from './reporter.ts';
import { createTestQueries } from './datasets/test-queries.ts';
import { loadDataset, convertToQueries } from './datasets/loader.ts';
import { createCostTracker } from './metrics/cost-tracker.ts';
import { createLatencyTracker } from './metrics/latency-tracker.ts';
import { loadConfig } from '../config.ts';
import { createLLMProvider } from '../providers/llm.ts';
import { createRAGClient } from '../providers/rag-client.ts';
import { createFTS5Storage } from '../wiki-agent/wiki/fts5-storage.ts';
import { createLogger } from '../logger.ts';

const log = createLogger('benchmark-cli');

async function main() {
  const { values } = parseArgs({
    options: {
      dataset: { type: 'string', short: 'd' },
      results: { type: 'string', short: 'r', default: './results' },
      report: { type: 'boolean', default: false },
      'wiki-dir': { type: 'string', default: './wiki' },
      'no-write': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
wiki-vs-rag Benchmark CLI

Usage:
  bun run benchmark                         Run benchmark with built-in test queries
  bun run benchmark -- --dataset <path>     Run with a custom Q&A dataset JSON file
  bun run benchmark -- --report             Show the latest benchmark report
  bun run benchmark -- --results <dir>      Custom results directory (default: ./results)
  bun run benchmark -- --wiki-dir <dir>     Wiki directory (default: ./wiki)
  bun run benchmark -- --no-write           Don't write results to disk

Options:
  -d, --dataset <path>    Path to a Q&A dataset JSON file
  -r, --results <dir>     Results output directory
      --report            Show the latest report instead of running
      --wiki-dir <dir>    Path to compiled wiki directory
      --no-write          Skip writing results to disk
  -h, --help              Show this help
`);
    return;
  }

  // Report mode: show latest results
  if (values.report) {
    await showReport(values.results!);
    return;
  }

  // Run mode
  await runBenchmarkCLI(values);
}

async function runBenchmarkCLI(values: Record<string, any>) {
  const config = loadConfig();
  const llm = createLLMProvider(config.llmProvider, config.openaiApiKey);
  const ragClient = createRAGClient(config.ragProvider, config.ragA2aUrl);
  const storage = createFTS5Storage(':memory:');

  // Try to re-index from wiki directory
  const wikiDir = values['wiki-dir'] as string;
  try {
    const indexed = await storage.reindexFromDisk(wikiDir);
    log.info({ indexed, wikiDir }, 'Wiki indexed for benchmark');
  } catch (err) {
    log.warn({ wikiDir, err }, 'Could not index wiki — continuing with empty storage');
  }

  // Load queries
  let queries;
  if (values.dataset) {
    const dataset = await loadDataset(values.dataset as string);
    queries = convertToQueries(dataset.items);
    console.log(`Loaded ${queries.length} queries from ${values.dataset}`);
  } else {
    queries = createTestQueries();
    console.log(`Using ${queries.length} built-in test queries`);
  }

  // Create trackers
  const costTracker = createCostTracker();
  const latencyTracker = createLatencyTracker();

  console.log('\n🏁 Starting benchmark...\n');

  const result: BenchmarkRunResult = await runBenchmark(queries, storage, llm, ragClient, {
    resultsDir: values.results as string,
    writeToDisk: !values['no-write'],
    costTracker,
    latencyTracker,
  });

  // Generate and show report
  const report = generateReport(result);
  console.log('\n' + renderReportTable(report));

  // Save report alongside results
  if (!values['no-write']) {
    const runDir = join(values.results as string, `run-${result.id}`);
    await saveReport(report, runDir);
    console.log(`\n📁 Results saved to: ${runDir}`);
  }

  storage.close();
}

async function showReport(resultsDir: string) {
  const latestDir = await findLatestRun(resultsDir);
  if (!latestDir) {
    console.log('No benchmark results found. Run `bun run benchmark` first.');
    return;
  }

  const run = await loadBenchmarkRun(latestDir);
  const report = generateReport(run);
  console.log(renderReportTable(report));
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
