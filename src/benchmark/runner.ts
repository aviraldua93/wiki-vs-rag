/**
 * Benchmark runner — orchestrates head-to-head evaluation.
 *
 * Runs the same queries against both wiki-agent and RAG system,
 * evaluates with RAGAS + LLM-as-Judge, tracks cost and latency,
 * and produces comprehensive results.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { v4 as uuid } from 'uuid';
import type {
  Query,
  Answer,
  BenchmarkResult,
  BenchmarkRun,
  BenchmarkSummary,
  LLMProvider,
  RAGClient,
  A2ATask,
} from '../types.ts';
import type { WikiFTS5Storage } from '../wiki-agent/wiki/fts5-storage.ts';
import { executeQuery } from '../wiki-agent/query/engine.ts';
import { computeRagasScores, computeJudgeScores, determineWinner } from './metrics/evaluator.ts';
import { CostTracker, createCostTracker } from './metrics/cost-tracker.ts';
import { LatencyTracker, createLatencyTracker } from './metrics/latency-tracker.ts';
import { createLogger } from '../logger.ts';

const log = createLogger('benchmark-runner');

/** Options for a benchmark run. */
export interface BenchmarkOptions {
  /** Directory to write results */
  resultsDir: string;
  /** Whether to write result files to disk */
  writeToDisk?: boolean;
  /** LLM model for judge evaluation */
  judgeModel?: string;
  /** Custom cost tracker (creates new one if not provided) */
  costTracker?: CostTracker;
  /** Custom latency tracker (creates new one if not provided) */
  latencyTracker?: LatencyTracker;
}

/** Extended benchmark run with tracking data. */
export interface BenchmarkRunResult extends BenchmarkRun {
  /** Cost tracking data */
  costData?: ReturnType<CostTracker['toJSON']>;
  /** Latency tracking data */
  latencyData?: ReturnType<LatencyTracker['toJSON']>;
}

/**
 * Run a single benchmark comparison for one query.
 */
async function runSingleBenchmark(
  query: Query,
  storage: WikiFTS5Storage,
  llm: LLMProvider,
  ragClient: RAGClient,
  costTracker: CostTracker,
  latencyTracker: LatencyTracker,
  judgeModel?: string,
): Promise<BenchmarkResult> {
  log.info({ queryId: query.id }, 'Running benchmark for query');

  // Get wiki answer
  const wikiStart = Date.now();
  const wikiAnswer = await executeQuery(query, storage, llm);
  const wikiLatency = Date.now() - wikiStart;
  latencyTracker.record('wiki', query.id, wikiLatency);

  // Track wiki query cost
  if (wikiAnswer.tokenUsage) {
    costTracker.record('wiki', 'query', judgeModel ?? 'gpt-4o-mini', wikiAnswer.tokenUsage, query.id);
  }

  // Get RAG answer
  const ragStart = Date.now();
  const ragTask: A2ATask = {
    id: query.id,
    message: query.text,
    metadata: { category: query.category },
  };
  const ragResult = await ragClient.query(ragTask);
  const ragLatency = Date.now() - ragStart;
  latencyTracker.record('rag', query.id, ragLatency);

  const ragAnswer: Answer = {
    queryId: query.id,
    text: ragResult.answer,
    citations: ragResult.citations,
    system: 'rag',
    latencyMs: ragResult.latencyMs,
    tokenUsage: ragResult.tokenUsage,
  };

  // Track RAG query cost
  if (ragResult.tokenUsage) {
    costTracker.record('rag', 'query', 'gpt-4o-mini', ragResult.tokenUsage, query.id);
  }

  // Evaluate with RAGAS
  const wikiRagasScores = await computeRagasScores(query, wikiAnswer, llm);
  const ragRagasScores = await computeRagasScores(query, ragAnswer, llm);

  // Evaluate with LLM-as-Judge
  const wikiJudgeScores = await computeJudgeScores(query, wikiAnswer, llm);
  const ragJudgeScores = await computeJudgeScores(query, ragAnswer, llm);

  // Determine winner
  const winner = determineWinner(wikiJudgeScores, ragJudgeScores);

  return {
    query,
    wikiAnswer,
    ragAnswer,
    wikiRagasScores,
    ragRagasScores,
    wikiJudgeScores,
    ragJudgeScores,
    winner,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Compute summary statistics from benchmark results.
 */
function computeSummary(results: BenchmarkResult[]): BenchmarkSummary {
  const byCategory: Record<string, { wikiWins: number; ragWins: number; ties: number }> = {};

  let wikiWins = 0;
  let ragWins = 0;
  let ties = 0;
  let totalWikiLatency = 0;
  let totalRagLatency = 0;
  let totalWikiCost = 0;
  let totalRagCost = 0;

  for (const result of results) {
    if (result.winner === 'wiki') wikiWins++;
    else if (result.winner === 'rag') ragWins++;
    else ties++;

    totalWikiLatency += result.wikiAnswer.latencyMs;
    totalRagLatency += result.ragAnswer.latencyMs;
    totalWikiCost += result.wikiAnswer.costUsd ?? 0;
    totalRagCost += result.ragAnswer.costUsd ?? 0;

    const cat = result.query.category ?? 'unknown';
    if (!byCategory[cat]) {
      byCategory[cat] = { wikiWins: 0, ragWins: 0, ties: 0 };
    }
    if (result.winner === 'wiki') byCategory[cat].wikiWins++;
    else if (result.winner === 'rag') byCategory[cat].ragWins++;
    else byCategory[cat].ties++;
  }

  const n = Math.max(results.length, 1);

  return {
    totalQueries: results.length,
    wikiWins,
    ragWins,
    ties,
    avgWikiLatencyMs: totalWikiLatency / n,
    avgRagLatencyMs: totalRagLatency / n,
    totalWikiCostUsd: totalWikiCost,
    totalRagCostUsd: totalRagCost,
    byCategory,
  };
}

/**
 * Run a full benchmark comparing wiki-agent vs RAG on a set of queries.
 *
 * @param queries - Questions to benchmark
 * @param storage - Wiki FTS5 storage with indexed pages
 * @param llm - LLM provider (used for wiki synthesis and evaluation)
 * @param ragClient - RAG A2A client (real or mock)
 * @param options - Benchmark configuration
 * @returns Complete benchmark run with results, summary, cost, and latency data
 */
export async function runBenchmark(
  queries: Query[],
  storage: WikiFTS5Storage,
  llm: LLMProvider,
  ragClient: RAGClient,
  options: BenchmarkOptions,
): Promise<BenchmarkRunResult> {
  const runId = uuid();
  const startedAt = new Date().toISOString();
  const costTracker = options.costTracker ?? createCostTracker();
  const latencyTracker = options.latencyTracker ?? createLatencyTracker();

  log.info({ runId, queryCount: queries.length }, 'Starting benchmark run');

  const results: BenchmarkResult[] = [];
  for (const query of queries) {
    const result = await runSingleBenchmark(
      query, storage, llm, ragClient,
      costTracker, latencyTracker, options.judgeModel,
    );
    results.push(result);
  }

  const summary = computeSummary(results);

  const run: BenchmarkRunResult = {
    id: runId,
    startedAt,
    completedAt: new Date().toISOString(),
    results,
    summary,
    costData: costTracker.toJSON(),
    latencyData: latencyTracker.toJSON(),
  };

  // Write results to disk if requested
  if (options.writeToDisk !== false) {
    const runDir = join(options.resultsDir, `run-${runId}`);
    await mkdir(runDir, { recursive: true });

    // Write main results
    await writeFile(join(runDir, 'results.json'), JSON.stringify(run, null, 2), 'utf-8');

    // Write per-question breakdowns
    await writeFile(join(runDir, 'per-question.json'), JSON.stringify(results, null, 2), 'utf-8');

    // Write summary
    await writeFile(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');

    // Write cost data
    await writeFile(join(runDir, 'costs.json'), JSON.stringify(costTracker.toJSON(), null, 2), 'utf-8');

    // Write latency data
    await writeFile(join(runDir, 'latency.json'), JSON.stringify(latencyTracker.toJSON(), null, 2), 'utf-8');

    log.info({ runDir }, 'Benchmark results written');
  }

  log.info(
    { runId, wikiWins: summary.wikiWins, ragWins: summary.ragWins, ties: summary.ties },
    'Benchmark run complete',
  );

  return run;
}
