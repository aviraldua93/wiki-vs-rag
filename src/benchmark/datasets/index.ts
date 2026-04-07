/**
 * Barrel export for datasets module.
 *
 * Primary exports from generator.ts + loader.ts (used by benchmark harness).
 * Alternative exports from qa-generator.ts + dataset-loader.ts (used by some tests).
 */

export { createTestQueries, queriesToBenchmark } from './test-queries.ts';
export type { QAPair } from './test-queries.ts';

// Primary Q&A generator (generator.ts)
export {
  generateSingleHopQuestions,
  generateMultiHopQuestions,
  generateComparisonQuestions,
  generateQADataset,
} from './generator.ts';
export type {
  GeneratedQA,
  QAGeneratorOptions,
  DifficultyLevel,
  ReasoningType,
} from './generator.ts';

// Primary dataset loader (loader.ts)
export {
  saveDataset,
  loadDataset,
  listDatasets,
  convertToQueries,
  loadDatasetAsQueries,
} from './loader.ts';
export type { QADataset, DatasetMetadata, DatasetInfo } from './loader.ts';

// Alternative loader utilities (dataset-loader.ts)
export {
  datasetToQueries,
  filterDatasetByCategory,
  mergeDatasets,
} from './dataset-loader.ts';
export type { DatasetSummary } from './dataset-loader.ts';
