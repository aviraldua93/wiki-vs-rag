/**
 * Barrel export for benchmark module.
 */

// Runner
export { runBenchmark } from './runner.ts';
export type { BenchmarkOptions, BenchmarkRunResult } from './runner.ts';

// Evaluator (RAGAS + Judge)
export { computeRagasScores, computeJudgeScores, determineWinner } from './metrics/evaluator.ts';

// RAGAS per-metric evaluators
export {
  evaluateFaithfulness,
  evaluateAnswerRelevancy,
  evaluateContextPrecision,
  evaluateContextRecall,
  computeAllRagasMetrics,
} from './metrics/ragas.ts';
export type { RagasMetricScores, MetricResult } from './metrics/ragas.ts';

// LLM-as-Judge evaluator
export { evaluateWithJudge, DEFAULT_JUDGE_RUBRIC } from './metrics/judge.ts';
export type { JudgeRubricDimension, JudgeEvalResult } from './metrics/judge.ts';

// Cost and latency tracking
export { CostTracker, createCostTracker } from './metrics/cost-tracker.ts';
export type { CostEntry, CostSummary } from './metrics/cost-tracker.ts';
export { LatencyTracker, createLatencyTracker } from './metrics/latency-tracker.ts';
export type { LatencyEntry, LatencyStats } from './metrics/latency-tracker.ts';

// Reporter
export {
  generateReport,
  renderReportTable,
  analyzeDimensions,
  loadBenchmarkRun,
  saveReport,
  findLatestRun,
} from './reporter.ts';
export type { ComparisonReport, DimensionResult } from './reporter.ts';

// Datasets — test queries
export { createTestQueries, queriesToBenchmark } from './datasets/test-queries.ts';
export type { QAPair } from './datasets/test-queries.ts';

// Datasets — Q&A generator
export {
  generateSingleHopQuestions,
  generateMultiHopQuestions,
  generateComparisonQuestions,
  generateQADataset,
} from './datasets/generator.ts';
export type {
  GeneratedQA,
  QAGeneratorOptions,
  DifficultyLevel,
  ReasoningType,
} from './datasets/generator.ts';

// Datasets — loader/persistence
export {
  saveDataset,
  loadDataset,
  listDatasets,
  convertToQueries,
  loadDatasetAsQueries,
} from './datasets/loader.ts';
export type { QADataset, DatasetMetadata, DatasetInfo } from './datasets/loader.ts';
