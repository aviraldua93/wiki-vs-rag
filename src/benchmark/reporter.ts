/**
 * Benchmark reporter — generates comparison tables and analysis.
 *
 * Produces per-dimension analysis matching the 8 benchmark dimensions
 * from the README: single-hop, multi-hop, quality, cost, build-cost,
 * latency, auditability, staleness.
 */

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import type {
  BenchmarkRun,
  BenchmarkResult,
  BenchmarkSummary,
  RagasScores,
  JudgeScores,
} from '../types.ts';
import type { CostSummary } from './metrics/cost-tracker.ts';
import type { LatencyStats } from './metrics/latency-tracker.ts';
import type { BenchmarkRunResult } from './runner.ts';
import { createLogger } from '../logger.ts';

const log = createLogger('reporter');

// ── Types ────────────────────────────────────────────────────────

/** A single dimension result in the comparison report. */
export interface DimensionResult {
  /** Dimension name */
  dimension: string;
  /** Metric used to measure */
  metric: string;
  /** Wiki system score or value */
  wikiValue: string;
  /** RAG system score or value */
  ragValue: string;
  /** Which system won */
  winner: 'wiki' | 'rag' | 'tie';
  /** Explanation of the comparison */
  explanation: string;
}

/** Full comparison report. */
export interface ComparisonReport {
  /** Report title */
  title: string;
  /** When the report was generated */
  generatedAt: string;
  /** Benchmark run ID */
  runId: string;
  /** Total queries evaluated */
  totalQueries: number;
  /** 8-dimension comparison results */
  dimensions: DimensionResult[];
  /** Overall winner */
  overallWinner: 'wiki' | 'rag' | 'tie';
  /** Summary statistics */
  summary: BenchmarkSummary;
  /** Per-category breakdown */
  categoryBreakdown: Record<string, { wikiWins: number; ragWins: number; ties: number }>;
}

// ── Dimension Analyzers ──────────────────────────────────────────

function avgRagas(results: BenchmarkResult[], system: 'wiki' | 'rag', field: keyof RagasScores): number {
  const scores = results
    .map((r) => system === 'wiki' ? r.wikiRagasScores : r.ragRagasScores)
    .filter((s): s is RagasScores => s != null);
  if (scores.length === 0) return 0;
  return scores.reduce((sum, s) => sum + s[field], 0) / scores.length;
}

function avgJudge(results: BenchmarkResult[], system: 'wiki' | 'rag', field: keyof Omit<JudgeScores, 'reasoning'>): number {
  const scores = results
    .map((r) => system === 'wiki' ? r.wikiJudgeScores : r.ragJudgeScores)
    .filter((s): s is JudgeScores => s != null);
  if (scores.length === 0) return 0;
  return scores.reduce((sum, s) => sum + (s[field] as number), 0) / scores.length;
}

function filterByCategory(results: BenchmarkResult[], category: string): BenchmarkResult[] {
  return results.filter((r) => r.query.category === category);
}

function winsCount(results: BenchmarkResult[], system: 'wiki' | 'rag'): number {
  return results.filter((r) => r.winner === system).length;
}

/**
 * Analyze the 8 benchmark dimensions from a run result.
 */
export function analyzeDimensions(run: BenchmarkRunResult): DimensionResult[] {
  const results = run.results;
  const dimensions: DimensionResult[] = [];

  // 1. Single-hop factoid accuracy
  const singleHop = filterByCategory(results, 'single-hop');
  if (singleHop.length > 0) {
    const wikiWins = winsCount(singleHop, 'wiki');
    const ragWins = winsCount(singleHop, 'rag');
    dimensions.push({
      dimension: 'Single-hop Factoid',
      metric: 'Precision@K (judge correctness)',
      wikiValue: `${(avgJudge(singleHop, 'wiki', 'correctness') * 100).toFixed(1)}%`,
      ragValue: `${(avgJudge(singleHop, 'rag', 'correctness') * 100).toFixed(1)}%`,
      winner: wikiWins > ragWins ? 'wiki' : ragWins > wikiWins ? 'rag' : 'tie',
      explanation: `Wiki: ${wikiWins} wins, RAG: ${ragWins} wins out of ${singleHop.length} single-hop questions`,
    });
  }

  // 2. Multi-hop reasoning
  const multiHop = filterByCategory(results, 'multi-hop');
  if (multiHop.length > 0) {
    const wikiWins = winsCount(multiHop, 'wiki');
    const ragWins = winsCount(multiHop, 'rag');
    dimensions.push({
      dimension: 'Multi-hop Reasoning',
      metric: 'Accuracy (completeness + correctness)',
      wikiValue: `${(((avgJudge(multiHop, 'wiki', 'correctness') + avgJudge(multiHop, 'wiki', 'completeness')) / 2) * 100).toFixed(1)}%`,
      ragValue: `${(((avgJudge(multiHop, 'rag', 'correctness') + avgJudge(multiHop, 'rag', 'completeness')) / 2) * 100).toFixed(1)}%`,
      winner: wikiWins > ragWins ? 'wiki' : ragWins > wikiWins ? 'rag' : 'tie',
      explanation: `Wiki: ${wikiWins} wins, RAG: ${ragWins} wins out of ${multiHop.length} multi-hop questions`,
    });
  }

  // 3. Answer quality (faithfulness across all)
  const wikiQuality = avgRagas(results, 'wiki', 'faithfulness');
  const ragQuality = avgRagas(results, 'rag', 'faithfulness');
  dimensions.push({
    dimension: 'Answer Quality',
    metric: 'Faithfulness (RAGAS)',
    wikiValue: `${(wikiQuality * 100).toFixed(1)}%`,
    ragValue: `${(ragQuality * 100).toFixed(1)}%`,
    winner: Math.abs(wikiQuality - ragQuality) < 0.05 ? 'tie' : wikiQuality > ragQuality ? 'wiki' : 'rag',
    explanation: `Average faithfulness across all ${results.length} questions`,
  });

  // 4. Cost per query
  if (run.costData) {
    const wikiCost = run.costData.wikiSummary.avgCostPerQuery;
    const ragCost = run.costData.ragSummary.avgCostPerQuery;
    dimensions.push({
      dimension: 'Cost per Query',
      metric: '$/query',
      wikiValue: `$${wikiCost.toFixed(6)}`,
      ragValue: `$${ragCost.toFixed(6)}`,
      winner: wikiCost < ragCost ? 'wiki' : ragCost < wikiCost ? 'rag' : 'tie',
      explanation: `Wiki amortized: $${run.costData.wikiSummary.compilationCostUsd.toFixed(6)} compilation + $${run.costData.wikiSummary.queryCostUsd.toFixed(6)} queries`,
    });
  }

  // 5. Build cost (one-time compilation)
  if (run.costData) {
    const wikiBuild = run.costData.wikiSummary.compilationCostUsd;
    const ragBuild = 0; // RAG has negligible build cost (just embedding)
    dimensions.push({
      dimension: 'Build Cost',
      metric: '$/corpus (one-time)',
      wikiValue: `$${wikiBuild.toFixed(6)}`,
      ragValue: `$${ragBuild.toFixed(6)}`,
      winner: wikiBuild <= ragBuild ? 'wiki' : 'rag',
      explanation: `Wiki requires LLM compilation; RAG uses cheaper embedding`,
    });
  }

  // 6. Latency
  if (run.latencyData) {
    const wikiP95 = run.latencyData.wikiStats.p95Ms;
    const ragP95 = run.latencyData.ragStats.p95Ms;
    dimensions.push({
      dimension: 'Latency',
      metric: 'p95 ms',
      wikiValue: `${wikiP95.toFixed(0)}ms`,
      ragValue: `${ragP95.toFixed(0)}ms`,
      winner: wikiP95 < ragP95 ? 'wiki' : ragP95 < wikiP95 ? 'rag' : 'tie',
      explanation: `Wiki p50: ${run.latencyData.wikiStats.p50Ms.toFixed(0)}ms, RAG p50: ${run.latencyData.ragStats.p50Ms.toFixed(0)}ms`,
    });
  }

  // 7. Auditability (citation quality)
  const wikiCitationQuality = avgJudge(results, 'wiki', 'citationQuality');
  const ragCitationQuality = avgJudge(results, 'rag', 'citationQuality');
  dimensions.push({
    dimension: 'Auditability',
    metric: 'Citation trace quality',
    wikiValue: `${(wikiCitationQuality * 100).toFixed(1)}%`,
    ragValue: `${(ragCitationQuality * 100).toFixed(1)}%`,
    winner: Math.abs(wikiCitationQuality - ragCitationQuality) < 0.05 ? 'tie' : wikiCitationQuality > ragCitationQuality ? 'wiki' : 'rag',
    explanation: `Wiki uses [[wikilinks]] for traceable citations; RAG uses vector similarity`,
  });

  // 8. Staleness handling
  const temporal = filterByCategory(results, 'temporal');
  if (temporal.length > 0) {
    const wikiWins = winsCount(temporal, 'wiki');
    const ragWins = winsCount(temporal, 'rag');
    dimensions.push({
      dimension: 'Staleness Handling',
      metric: 'Post-update accuracy',
      wikiValue: `${(avgJudge(temporal, 'wiki', 'correctness') * 100).toFixed(1)}%`,
      ragValue: `${(avgJudge(temporal, 'rag', 'correctness') * 100).toFixed(1)}%`,
      winner: wikiWins > ragWins ? 'wiki' : ragWins > wikiWins ? 'rag' : 'tie',
      explanation: `Wiki: ${wikiWins} wins, RAG: ${ragWins} wins out of ${temporal.length} temporal questions`,
    });
  }

  return dimensions;
}

// ── Report Generation ────────────────────────────────────────────

/**
 * Generate a full comparison report from a benchmark run.
 */
export function generateReport(run: BenchmarkRunResult): ComparisonReport {
  const dimensions = analyzeDimensions(run);

  // Count dimension winners
  const dimensionWikiWins = dimensions.filter((d) => d.winner === 'wiki').length;
  const dimensionRagWins = dimensions.filter((d) => d.winner === 'rag').length;

  const overallWinner: 'wiki' | 'rag' | 'tie' =
    dimensionWikiWins > dimensionRagWins ? 'wiki' :
    dimensionRagWins > dimensionWikiWins ? 'rag' : 'tie';

  return {
    title: 'Wiki vs RAG Benchmark Comparison',
    generatedAt: new Date().toISOString(),
    runId: run.id,
    totalQueries: run.results.length,
    dimensions,
    overallWinner,
    summary: run.summary!,
    categoryBreakdown: run.summary!.byCategory,
  };
}

// ── Text Table Rendering ─────────────────────────────────────────

/**
 * Render a comparison report as a formatted text table.
 */
export function renderReportTable(report: ComparisonReport): string {
  const lines: string[] = [];

  lines.push('╔══════════════════════════════════════════════════════════════════╗');
  lines.push('║          WIKI vs RAG — HEAD-TO-HEAD BENCHMARK RESULTS          ║');
  lines.push('╠══════════════════════════════════════════════════════════════════╣');
  lines.push(`║  Run: ${report.runId.slice(0, 8)}...  |  Queries: ${report.totalQueries}  |  Winner: ${report.overallWinner.toUpperCase()}`);
  lines.push('╠═══════════════════╦═══════════╦════════════╦════════════╦═══════╣');
  lines.push('║ Dimension         ║ Metric    ║ Wiki       ║ RAG        ║Winner ║');
  lines.push('╠═══════════════════╬═══════════╬════════════╬════════════╬═══════╣');

  for (const dim of report.dimensions) {
    const d = pad(dim.dimension, 17);
    const m = pad(dim.metric.slice(0, 9), 9);
    const w = pad(dim.wikiValue, 10);
    const r = pad(dim.ragValue, 10);
    const wn = pad(dim.winner.toUpperCase(), 5);
    lines.push(`║ ${d} ║ ${m} ║ ${w} ║ ${r} ║ ${wn} ║`);
  }

  lines.push('╠═══════════════════╩═══════════╩════════════╩════════════╩═══════╣');
  lines.push('║                     SUMMARY                                    ║');
  lines.push('╠════════════════════════════════════════════════════════════════╣');
  lines.push(`║  Overall Winner: ${report.overallWinner.toUpperCase()}`);
  lines.push(`║  Wiki Wins: ${report.summary.wikiWins}  |  RAG Wins: ${report.summary.ragWins}  |  Ties: ${report.summary.ties}`);
  lines.push(`║  Avg Wiki Latency: ${report.summary.avgWikiLatencyMs.toFixed(0)}ms  |  Avg RAG Latency: ${report.summary.avgRagLatencyMs.toFixed(0)}ms`);
  lines.push('╚══════════════════════════════════════════════════════════════════╝');

  // Category breakdown
  if (Object.keys(report.categoryBreakdown).length > 0) {
    lines.push('');
    lines.push('Per-Category Breakdown:');
    for (const [cat, counts] of Object.entries(report.categoryBreakdown)) {
      lines.push(`  ${cat}: Wiki ${counts.wikiWins} | RAG ${counts.ragWins} | Ties ${counts.ties}`);
    }
  }

  return lines.join('\n');
}

function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

// ── File I/O ─────────────────────────────────────────────────────

/**
 * Load a benchmark run from a results directory.
 */
export async function loadBenchmarkRun(runDir: string): Promise<BenchmarkRunResult> {
  const resultsPath = join(runDir, 'results.json');
  const raw = await readFile(resultsPath, 'utf-8');
  return JSON.parse(raw) as BenchmarkRunResult;
}

/**
 * Save a comparison report to a file.
 */
export async function saveReport(report: ComparisonReport, dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, 'report.json');
  await writeFile(filePath, JSON.stringify(report, null, 2), 'utf-8');

  // Also save text table
  const tablePath = join(dir, 'report.txt');
  await writeFile(tablePath, renderReportTable(report), 'utf-8');

  log.info({ dir }, 'Report saved');
  return filePath;
}

/**
 * Find the latest benchmark run directory.
 */
export async function findLatestRun(resultsDir: string): Promise<string | null> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(resultsDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const runDirs = entries
    .filter((e) => e.isDirectory() && e.name.startsWith('run-'))
    .map((e) => e.name)
    .sort()
    .reverse();

  return runDirs.length > 0 ? join(resultsDir, runDirs[0]) : null;
}
