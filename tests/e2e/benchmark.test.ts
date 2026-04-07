/**
 * E2E Test: Benchmark harness — run mini-benchmark with mocks → verify results.
 *
 * Tests the full benchmark flow: wiki-agent + mock RAG → evaluate → produce results.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { loadCorpus } from '../../src/corpus/loader.ts';
import { runIngestPipeline } from '../../src/wiki-agent/ingest/pipeline.ts';
import { createFTS5Storage, WikiFTS5Storage } from '../../src/wiki-agent/wiki/fts5-storage.ts';
import { runBenchmark } from '../../src/benchmark/runner.ts';
import { createTestQueries } from '../../src/benchmark/datasets/test-queries.ts';
import { MockLLM } from '../../src/providers/llm.ts';
import { MockRAGClient } from '../../src/providers/rag-client.ts';
import { resetConfig } from '../../src/config.ts';
import type { BenchmarkRun } from '../../src/types.ts';

// Silence logger during tests
process.env.LOG_LEVEL = 'silent';

const CORPUS_DIR = join(import.meta.dir, '..', '..', 'corpus');

describe('E2E Benchmark: Wiki vs RAG', () => {
  let storage: WikiFTS5Storage;
  let llm: MockLLM;
  let ragClient: MockRAGClient;
  let resultsDir: string;
  let benchmarkRun: BenchmarkRun;

  beforeAll(async () => {
    resetConfig();
    storage = createFTS5Storage(':memory:');
    llm = new MockLLM();
    ragClient = new MockRAGClient({
      defaultAnswer: 'Mock RAG answer: Meridian is a data processing platform.',
      responseMap: {
        'rate limit': 'The free tier rate limit is 100 requests per minute.',
        'query engine': 'Lin Wei led the query engine rewrite with 83% latency improvement.',
        'kafka': 'The recommended max_poll_records changed from 500 to 2000.',
      },
    });

    // Create temp results dir
    resultsDir = await mkdtemp(join(tmpdir(), 'benchmark-results-'));

    // Ingest the real corpus
    const docs = await loadCorpus(CORPUS_DIR);
    await runIngestPipeline(docs, llm, storage, {
      wikiDir: './wiki',
      writeToDisk: false,
    });

    // Run the benchmark
    const queries = createTestQueries();
    benchmarkRun = await runBenchmark(queries, storage, llm, ragClient, {
      resultsDir,
      writeToDisk: true,
    });
  });

  afterAll(async () => {
    storage.close();
    await rm(resultsDir, { recursive: true, force: true });
  });

  test('benchmark run has a valid ID and timestamps', () => {
    expect(benchmarkRun.id).toBeDefined();
    expect(benchmarkRun.id.length).toBeGreaterThan(0);
    expect(benchmarkRun.startedAt).toBeDefined();
    expect(benchmarkRun.completedAt).toBeDefined();
  });

  test('benchmark produces results for all queries', () => {
    const queries = createTestQueries();
    expect(benchmarkRun.results.length).toBe(queries.length);
  });

  test('each result has both wiki and RAG answers', () => {
    for (const result of benchmarkRun.results) {
      expect(result.wikiAnswer).toBeDefined();
      expect(result.wikiAnswer.system).toBe('wiki');
      expect(result.wikiAnswer.text.length).toBeGreaterThan(0);

      expect(result.ragAnswer).toBeDefined();
      expect(result.ragAnswer.system).toBe('rag');
      expect(result.ragAnswer.text.length).toBeGreaterThan(0);
    }
  });

  test('each result has RAGAS scores for both systems', () => {
    for (const result of benchmarkRun.results) {
      expect(result.wikiRagasScores).toBeDefined();
      expect(result.wikiRagasScores!.faithfulness).toBeGreaterThanOrEqual(0);
      expect(result.wikiRagasScores!.faithfulness).toBeLessThanOrEqual(1);

      expect(result.ragRagasScores).toBeDefined();
      expect(result.ragRagasScores!.faithfulness).toBeGreaterThanOrEqual(0);
    }
  });

  test('each result has Judge scores for both systems', () => {
    for (const result of benchmarkRun.results) {
      expect(result.wikiJudgeScores).toBeDefined();
      expect(result.wikiJudgeScores!.correctness).toBeGreaterThanOrEqual(0);
      expect(result.wikiJudgeScores!.completeness).toBeGreaterThanOrEqual(0);
      expect(result.wikiJudgeScores!.coherence).toBeGreaterThanOrEqual(0);
      expect(result.wikiJudgeScores!.citationQuality).toBeGreaterThanOrEqual(0);

      expect(result.ragJudgeScores).toBeDefined();
      expect(result.ragJudgeScores!.correctness).toBeGreaterThanOrEqual(0);
    }
  });

  test('each result has a winner determination', () => {
    for (const result of benchmarkRun.results) {
      expect(result.winner).toBeDefined();
      expect(['wiki', 'rag', 'tie']).toContain(result.winner);
    }
  });

  test('benchmark summary has correct totals', () => {
    expect(benchmarkRun.summary).toBeDefined();
    const summary = benchmarkRun.summary!;
    const queries = createTestQueries();

    expect(summary.totalQueries).toBe(queries.length);
    expect(summary.wikiWins + summary.ragWins + summary.ties).toBe(queries.length);
    expect(summary.avgWikiLatencyMs).toBeGreaterThanOrEqual(0);
    expect(summary.avgRagLatencyMs).toBeGreaterThanOrEqual(0);
  });

  test('benchmark summary includes category breakdown', () => {
    const summary = benchmarkRun.summary!;
    expect(summary.byCategory).toBeDefined();
    // Our test queries include at least single-hop and multi-hop categories
    expect(Object.keys(summary.byCategory).length).toBeGreaterThan(0);
  });

  test('results file was written to disk', async () => {
    const files = await readdir(resultsDir);
    // Results are now written to run-{id}/ subdirectory
    const runDirs = files.filter((f) => f.startsWith('run-'));
    expect(runDirs.length).toBe(1);

    // Verify the results.json file contains valid JSON
    const runDir = join(resultsDir, runDirs[0]);
    const runFiles = await readdir(runDir);
    expect(runFiles).toContain('results.json');

    const content = await readFile(join(runDir, 'results.json'), 'utf-8');
    const parsed = JSON.parse(content) as BenchmarkRun;
    expect(parsed.id).toBe(benchmarkRun.id);
    expect(parsed.results.length).toBe(benchmarkRun.results.length);
  });

  test('results file contains all metric dimensions', async () => {
    const files = await readdir(resultsDir);
    const runDir = join(resultsDir, files.find((f) => f.startsWith('run-'))!);
    const content = await readFile(join(runDir, 'results.json'), 'utf-8');
    const parsed = JSON.parse(content) as BenchmarkRun;

    // Check that all metric dimensions are present in the output
    expect(parsed.summary).toBeDefined();
    expect(parsed.summary!.totalQueries).toBeGreaterThan(0);
    expect(parsed.summary!.avgWikiLatencyMs).toBeDefined();
    expect(parsed.summary!.avgRagLatencyMs).toBeDefined();
    expect(parsed.summary!.totalWikiCostUsd).toBeDefined();
    expect(parsed.summary!.totalRagCostUsd).toBeDefined();
    expect(parsed.summary!.wikiWins).toBeDefined();
    expect(parsed.summary!.ragWins).toBeDefined();
    expect(parsed.summary!.ties).toBeDefined();
    expect(parsed.summary!.byCategory).toBeDefined();

    // Individual results have all dimensions
    for (const result of parsed.results) {
      expect(result.wikiRagasScores).toBeDefined();
      expect(result.ragRagasScores).toBeDefined();
      expect(result.wikiJudgeScores).toBeDefined();
      expect(result.ragJudgeScores).toBeDefined();
      expect(result.wikiAnswer.latencyMs).toBeDefined();
      expect(result.ragAnswer.latencyMs).toBeDefined();
    }
  });

  test('RAG client was called for each query', () => {
    const queries = createTestQueries();
    expect(ragClient.getCallCount()).toBe(queries.length);
  });

  test('entire benchmark completes in under 30 seconds', () => {
    const start = new Date(benchmarkRun.startedAt).getTime();
    const end = new Date(benchmarkRun.completedAt!).getTime();
    expect(end - start).toBeLessThan(30000);
  });

  test('each result has a timestamp', () => {
    for (const result of benchmarkRun.results) {
      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).getTime()).toBeGreaterThan(0);
    }
  });

  test('wiki answers have latency tracking', () => {
    for (const result of benchmarkRun.results) {
      expect(result.wikiAnswer.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  test('RAG answers have latency tracking', () => {
    for (const result of benchmarkRun.results) {
      expect(result.ragAnswer.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });
});
