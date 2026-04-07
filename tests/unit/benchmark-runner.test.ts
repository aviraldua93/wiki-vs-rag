/**
 * Unit tests for benchmark runner, reporter, and CLI flow.
 *
 * Tests:
 * - Full benchmark flow with mock providers
 * - Results include aggregate scores AND per-question breakdowns
 * - Reporter generates comparison tables with 8 dimensions
 * - Cost and latency data is tracked and included
 * - Results written to run-{timestamp}/ directory structure
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { readFile, rm, mkdir, readdir } from 'node:fs/promises';
import { runBenchmark } from '../../src/benchmark/runner.ts';
import type { BenchmarkRunResult } from '../../src/benchmark/runner.ts';
import {
  generateReport,
  renderReportTable,
  analyzeDimensions,
  saveReport,
} from '../../src/benchmark/reporter.ts';
import type { ComparisonReport, DimensionResult } from '../../src/benchmark/reporter.ts';
import { createTestQueries } from '../../src/benchmark/datasets/test-queries.ts';
import { createCostTracker } from '../../src/benchmark/metrics/cost-tracker.ts';
import { createLatencyTracker } from '../../src/benchmark/metrics/latency-tracker.ts';
import { MockLLM } from '../../src/providers/llm.ts';
import { MockRAGClient } from '../../src/providers/rag-client.ts';
import { WikiFTS5Storage } from '../../src/wiki-agent/wiki/fts5-storage.ts';
import type { Query, WikiPage } from '../../src/types.ts';

// Silence logger during tests
process.env.LOG_LEVEL = 'silent';

const TEST_RESULTS_DIR = join(import.meta.dir, '..', '..', '.test-benchmark-results');

// ── Test Helpers ─────────────────────────────────────────────────

function createTestStorage(): WikiFTS5Storage {
  const storage = new WikiFTS5Storage(':memory:');
  // Add some test pages so wiki queries have context
  const testPages: WikiPage[] = [
    {
      title: 'API Reference',
      type: 'source',
      tags: ['api', 'technical'],
      sources: ['api-reference.md'],
      content: 'The Meridian API free tier allows 100 requests per minute and 10,000 requests per day. Enterprise tier allows 10,000 req/min.',
      wikilinks: ['Configuration Guide'],
      created: '2025-01-01',
      updated: '2025-01-01',
      filePath: 'sources/api-reference.md',
    },
    {
      title: 'System Architecture',
      type: 'source',
      tags: ['architecture', 'technical'],
      sources: ['system-architecture.md'],
      content: 'Meridian is a distributed data processing platform. It processes 2.3 billion events daily. Lin Wei led the query engine rewrite.',
      wikilinks: ['API Reference', 'Project History'],
      created: '2025-01-01',
      updated: '2025-01-01',
      filePath: 'sources/system-architecture.md',
    },
    {
      title: 'Project History',
      type: 'source',
      tags: ['history', 'narrative'],
      sources: ['project-history.md'],
      content: 'Meridian was created by Dr. Sarah Chen in 2022. Lin Wei achieved 83% improvement in p95 query latency from 8.2s to 1.4s.',
      wikilinks: ['System Architecture'],
      created: '2025-01-01',
      updated: '2025-01-01',
      filePath: 'sources/project-history.md',
    },
  ];

  for (const page of testPages) {
    storage.upsertPage(page);
  }

  return storage;
}

function makeSmallQuerySet(): Query[] {
  return [
    {
      id: 'test-q-1',
      text: 'What is the API rate limit?',
      expectedAnswer: '100 requests per minute.',
      category: 'single-hop',
    },
    {
      id: 'test-q-2',
      text: 'Who led the query engine rewrite and what improvement was achieved?',
      expectedAnswer: 'Lin Wei led it, achieving 83% improvement.',
      category: 'multi-hop',
    },
  ];
}

// ── Cleanup ──────────────────────────────────────────────────────

afterEach(async () => {
  try {
    await rm(TEST_RESULTS_DIR, { recursive: true, force: true });
  } catch {}
});

// ── Benchmark Runner ─────────────────────────────────────────────

describe('runBenchmark', () => {
  let llm: MockLLM;
  let ragClient: MockRAGClient;
  let storage: WikiFTS5Storage;

  beforeEach(() => {
    llm = new MockLLM();
    ragClient = new MockRAGClient();
    storage = createTestStorage();
  });

  test('produces results for all queries', async () => {
    const queries = makeSmallQuerySet();
    const result = await runBenchmark(queries, storage, llm, ragClient, {
      resultsDir: TEST_RESULTS_DIR,
      writeToDisk: false,
    });

    expect(result.results).toHaveLength(2);
    expect(result.id).toBeDefined();
    expect(result.startedAt).toBeDefined();
    expect(result.completedAt).toBeDefined();
  });

  test('each result has wiki and rag answers', async () => {
    const queries = makeSmallQuerySet();
    const result = await runBenchmark(queries, storage, llm, ragClient, {
      resultsDir: TEST_RESULTS_DIR,
      writeToDisk: false,
    });

    for (const r of result.results) {
      expect(r.wikiAnswer).toBeDefined();
      expect(r.wikiAnswer.system).toBe('wiki');
      expect(r.ragAnswer).toBeDefined();
      expect(r.ragAnswer.system).toBe('rag');
      expect(r.wikiAnswer.text.length).toBeGreaterThan(0);
      expect(r.ragAnswer.text.length).toBeGreaterThan(0);
    }
  });

  test('each result has RAGAS and judge scores', async () => {
    const queries = makeSmallQuerySet();
    const result = await runBenchmark(queries, storage, llm, ragClient, {
      resultsDir: TEST_RESULTS_DIR,
      writeToDisk: false,
    });

    for (const r of result.results) {
      expect(r.wikiRagasScores).toBeDefined();
      expect(r.ragRagasScores).toBeDefined();
      expect(r.wikiJudgeScores).toBeDefined();
      expect(r.ragJudgeScores).toBeDefined();
      expect(r.winner).toBeDefined();
      expect(['wiki', 'rag', 'tie']).toContain(r.winner!);
    }
  });

  test('computes summary statistics', async () => {
    const queries = makeSmallQuerySet();
    const result = await runBenchmark(queries, storage, llm, ragClient, {
      resultsDir: TEST_RESULTS_DIR,
      writeToDisk: false,
    });

    expect(result.summary).toBeDefined();
    expect(result.summary!.totalQueries).toBe(2);
    expect(result.summary!.wikiWins + result.summary!.ragWins + result.summary!.ties).toBe(2);
  });

  test('includes cost tracking data', async () => {
    const costTracker = createCostTracker();
    const queries = makeSmallQuerySet();
    const result = await runBenchmark(queries, storage, llm, ragClient, {
      resultsDir: TEST_RESULTS_DIR,
      writeToDisk: false,
      costTracker,
    });

    expect(result.costData).toBeDefined();
    expect(result.costData!.entries.length).toBeGreaterThan(0);
    expect(result.costData!.wikiSummary).toBeDefined();
    expect(result.costData!.ragSummary).toBeDefined();
  });

  test('includes latency tracking data', async () => {
    const latencyTracker = createLatencyTracker();
    const queries = makeSmallQuerySet();
    const result = await runBenchmark(queries, storage, llm, ragClient, {
      resultsDir: TEST_RESULTS_DIR,
      writeToDisk: false,
      latencyTracker,
    });

    expect(result.latencyData).toBeDefined();
    expect(result.latencyData!.entries.length).toBeGreaterThan(0);
    expect(result.latencyData!.wikiStats).toBeDefined();
    expect(result.latencyData!.ragStats).toBeDefined();
  });

  test('writes results to run directory', async () => {
    const queries = makeSmallQuerySet();
    const result = await runBenchmark(queries, storage, llm, ragClient, {
      resultsDir: TEST_RESULTS_DIR,
      writeToDisk: true,
    });

    const runDir = join(TEST_RESULTS_DIR, `run-${result.id}`);
    const files = await readdir(runDir);

    expect(files).toContain('results.json');
    expect(files).toContain('per-question.json');
    expect(files).toContain('summary.json');
    expect(files).toContain('costs.json');
    expect(files).toContain('latency.json');
  });

  test('per-question breakdown matches results count', async () => {
    const queries = makeSmallQuerySet();
    const result = await runBenchmark(queries, storage, llm, ragClient, {
      resultsDir: TEST_RESULTS_DIR,
      writeToDisk: true,
    });

    const runDir = join(TEST_RESULTS_DIR, `run-${result.id}`);
    const perQ = JSON.parse(await readFile(join(runDir, 'per-question.json'), 'utf-8'));
    expect(perQ).toHaveLength(2);
  });

  test('summary JSON is valid', async () => {
    const queries = makeSmallQuerySet();
    const result = await runBenchmark(queries, storage, llm, ragClient, {
      resultsDir: TEST_RESULTS_DIR,
      writeToDisk: true,
    });

    const runDir = join(TEST_RESULTS_DIR, `run-${result.id}`);
    const summary = JSON.parse(await readFile(join(runDir, 'summary.json'), 'utf-8'));
    expect(summary.totalQueries).toBe(2);
  });

  test('category breakdown is included', async () => {
    const queries = makeSmallQuerySet();
    const result = await runBenchmark(queries, storage, llm, ragClient, {
      resultsDir: TEST_RESULTS_DIR,
      writeToDisk: false,
    });

    expect(result.summary!.byCategory).toBeDefined();
    expect(result.summary!.byCategory['single-hop']).toBeDefined();
    expect(result.summary!.byCategory['multi-hop']).toBeDefined();
  });
});

// ── Reporter ─────────────────────────────────────────────────────

describe('generateReport', () => {
  let run: BenchmarkRunResult;

  beforeEach(async () => {
    const llm = new MockLLM();
    const ragClient = new MockRAGClient();
    const storage = createTestStorage();
    const costTracker = createCostTracker();
    const latencyTracker = createLatencyTracker();

    run = await runBenchmark(makeSmallQuerySet(), storage, llm, ragClient, {
      resultsDir: TEST_RESULTS_DIR,
      writeToDisk: false,
      costTracker,
      latencyTracker,
    });
  });

  test('produces a valid comparison report', () => {
    const report = generateReport(run);
    expect(report.title).toBe('Wiki vs RAG Benchmark Comparison');
    expect(report.runId).toBe(run.id);
    expect(report.totalQueries).toBe(2);
    expect(report.dimensions.length).toBeGreaterThan(0);
    expect(['wiki', 'rag', 'tie']).toContain(report.overallWinner);
  });

  test('includes dimension analysis', () => {
    const report = generateReport(run);
    const dimensionNames = report.dimensions.map((d) => d.dimension);
    expect(dimensionNames).toContain('Answer Quality');
    expect(dimensionNames).toContain('Auditability');
  });

  test('each dimension has wiki and rag values', () => {
    const report = generateReport(run);
    for (const dim of report.dimensions) {
      expect(dim.wikiValue).toBeDefined();
      expect(dim.ragValue).toBeDefined();
      expect(['wiki', 'rag', 'tie']).toContain(dim.winner);
      expect(dim.explanation.length).toBeGreaterThan(0);
    }
  });

  test('includes summary and category breakdown', () => {
    const report = generateReport(run);
    expect(report.summary.totalQueries).toBe(2);
    expect(report.categoryBreakdown).toBeDefined();
  });
});

describe('renderReportTable', () => {
  test('produces non-empty text output', async () => {
    const llm = new MockLLM();
    const ragClient = new MockRAGClient();
    const storage = createTestStorage();
    const run = await runBenchmark(makeSmallQuerySet(), storage, llm, ragClient, {
      resultsDir: TEST_RESULTS_DIR,
      writeToDisk: false,
    });

    const report = generateReport(run);
    const table = renderReportTable(report);

    expect(table.length).toBeGreaterThan(100);
    expect(table).toContain('WIKI vs RAG');
    expect(table).toContain('SUMMARY');
    expect(table).toContain('Winner');
  });
});

describe('analyzeDimensions', () => {
  test('includes cost dimensions when cost data present', async () => {
    const llm = new MockLLM();
    const ragClient = new MockRAGClient();
    const storage = createTestStorage();
    const costTracker = createCostTracker();
    const latencyTracker = createLatencyTracker();

    const run = await runBenchmark(makeSmallQuerySet(), storage, llm, ragClient, {
      resultsDir: TEST_RESULTS_DIR,
      writeToDisk: false,
      costTracker,
      latencyTracker,
    });

    const dimensions = analyzeDimensions(run);
    const dimNames = dimensions.map((d) => d.dimension);
    expect(dimNames).toContain('Cost per Query');
    expect(dimNames).toContain('Build Cost');
    expect(dimNames).toContain('Latency');
  });

  test('includes single-hop and multi-hop dimensions', async () => {
    const llm = new MockLLM();
    const ragClient = new MockRAGClient();
    const storage = createTestStorage();

    const run = await runBenchmark(makeSmallQuerySet(), storage, llm, ragClient, {
      resultsDir: TEST_RESULTS_DIR,
      writeToDisk: false,
    });

    const dimensions = analyzeDimensions(run);
    const dimNames = dimensions.map((d) => d.dimension);
    expect(dimNames).toContain('Single-hop Factoid');
    expect(dimNames).toContain('Multi-hop Reasoning');
  });
});

describe('saveReport', () => {
  test('saves report as JSON and text', async () => {
    const llm = new MockLLM();
    const ragClient = new MockRAGClient();
    const storage = createTestStorage();
    const run = await runBenchmark(makeSmallQuerySet(), storage, llm, ragClient, {
      resultsDir: TEST_RESULTS_DIR,
      writeToDisk: false,
    });

    const report = generateReport(run);
    await saveReport(report, TEST_RESULTS_DIR);

    const files = await readdir(TEST_RESULTS_DIR);
    expect(files).toContain('report.json');
    expect(files).toContain('report.txt');

    const jsonReport = JSON.parse(await readFile(join(TEST_RESULTS_DIR, 'report.json'), 'utf-8'));
    expect(jsonReport.title).toBe('Wiki vs RAG Benchmark Comparison');

    const textReport = await readFile(join(TEST_RESULTS_DIR, 'report.txt'), 'utf-8');
    expect(textReport).toContain('WIKI vs RAG');
  });
});

// ── Full Flow Integration ────────────────────────────────────────

describe('Full benchmark flow', () => {
  test('end-to-end: run → evaluate → report', async () => {
    const llm = new MockLLM();
    const ragClient = new MockRAGClient();
    const storage = createTestStorage();
    const costTracker = createCostTracker();
    const latencyTracker = createLatencyTracker();

    // Step 1: Run benchmark
    const run = await runBenchmark(
      createTestQueries().slice(0, 3), // Use first 3 built-in queries
      storage, llm, ragClient,
      {
        resultsDir: TEST_RESULTS_DIR,
        writeToDisk: true,
        costTracker,
        latencyTracker,
      },
    );

    // Step 2: Verify results
    expect(run.results.length).toBe(3);
    expect(run.summary).toBeDefined();
    expect(run.costData).toBeDefined();
    expect(run.latencyData).toBeDefined();

    // Step 3: Generate report
    const report = generateReport(run);
    expect(report.dimensions.length).toBeGreaterThan(0);
    expect(report.totalQueries).toBe(3);

    // Step 4: Verify files on disk
    const runDir = join(TEST_RESULTS_DIR, `run-${run.id}`);
    const files = await readdir(runDir);
    expect(files).toContain('results.json');
    expect(files).toContain('per-question.json');
    expect(files).toContain('summary.json');
    expect(files).toContain('costs.json');
    expect(files).toContain('latency.json');

    // Step 5: Save report
    await saveReport(report, runDir);
    const allFiles = await readdir(runDir);
    expect(allFiles).toContain('report.json');
    expect(allFiles).toContain('report.txt');

    // Step 6: Verify per-question breakdown
    const perQ = JSON.parse(await readFile(join(runDir, 'per-question.json'), 'utf-8'));
    expect(perQ).toHaveLength(3);

    // Each question should have both system answers + scores
    for (const result of perQ) {
      expect(result.wikiAnswer).toBeDefined();
      expect(result.ragAnswer).toBeDefined();
      expect(result.wikiRagasScores).toBeDefined();
      expect(result.ragRagasScores).toBeDefined();
      expect(result.wikiJudgeScores).toBeDefined();
      expect(result.ragJudgeScores).toBeDefined();
    }
  });
});
