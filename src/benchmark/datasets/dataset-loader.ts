/**
 * Dataset loader — reads and writes Q&A datasets as JSON files.
 *
 * Manages persistence of generated Q&A datasets for reproducible benchmarks.
 * Datasets are stored in src/benchmark/datasets/ or a configurable path.
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import type { Query, QueryCategory } from '../../types.ts';
import type { QADataset, GeneratedQA } from './qa-generator.ts';
import { createLogger } from '../../logger.ts';
import { v4 as uuid } from 'uuid';

const log = createLogger('dataset-loader');

// ── Types ────────────────────────────────────────────────────────

/** Summary of a loaded dataset. */
export interface DatasetSummary {
  name: string;
  filePath: string;
  count: number;
  generatedAt: string;
  categories: string[];
}

// ── Save/Load Functions ──────────────────────────────────────────

/**
 * Save a Q&A dataset to a JSON file.
 *
 * @param dataset - The Q&A dataset to save
 * @param dir - Directory to save the file in
 * @param filename - Optional filename (defaults to dataset name)
 * @returns Full path to the saved file
 */
export async function saveDataset(
  dataset: QADataset,
  dir: string,
  filename?: string,
): Promise<string> {
  await mkdir(dir, { recursive: true });

  const fname = filename ?? `${dataset.name}.json`;
  const filePath = join(dir, fname);

  await writeFile(filePath, JSON.stringify(dataset, null, 2), 'utf-8');
  log.info({ filePath, count: dataset.count }, 'Dataset saved');

  return filePath;
}

/**
 * Load a Q&A dataset from a JSON file.
 *
 * @param filePath - Path to the JSON dataset file
 * @returns The loaded Q&A dataset
 */
export async function loadDataset(filePath: string): Promise<QADataset> {
  const raw = await readFile(filePath, 'utf-8');
  const dataset = JSON.parse(raw) as QADataset;

  log.info({ filePath, count: dataset.count, name: dataset.name }, 'Dataset loaded');
  return dataset;
}

/**
 * List all Q&A datasets in a directory.
 *
 * @param dir - Directory to scan for JSON dataset files
 * @returns Array of dataset summaries
 */
export async function listDatasets(dir: string): Promise<DatasetSummary[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    log.warn({ dir }, 'Dataset directory does not exist');
    return [];
  }

  const summaries: DatasetSummary[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name) !== '.json') continue;

    const filePath = join(dir, entry.name);
    try {
      const raw = await readFile(filePath, 'utf-8');
      const dataset = JSON.parse(raw) as QADataset;

      if (dataset.items && Array.isArray(dataset.items)) {
        const categories = [...new Set(dataset.items.map((item: GeneratedQA) => item.category))];
        summaries.push({
          name: dataset.name ?? entry.name,
          filePath,
          count: dataset.count ?? dataset.items.length,
          generatedAt: dataset.generatedAt ?? 'unknown',
          categories,
        });
      }
    } catch (err) {
      log.warn({ filePath, err }, 'Failed to parse dataset file');
    }
  }

  return summaries;
}

// ── Conversion Functions ─────────────────────────────────────────

/**
 * Convert a QADataset to Query[] for benchmark execution.
 *
 * Maps each GeneratedQA item to a Query with all required fields.
 */
export function datasetToQueries(dataset: QADataset): Query[] {
  return dataset.items.map((item) => ({
    id: item.id || uuid(),
    text: item.question,
    expectedAnswer: item.groundTruthAnswer,
    category: item.category,
    metadata: {
      sourceDocIds: item.sourceDocIds,
      sourceDocTitles: item.sourceDocTitles,
      reasoningType: item.reasoningType,
      difficulty: item.difficulty,
    },
  }));
}

/**
 * Filter dataset items by category.
 */
export function filterDatasetByCategory(
  dataset: QADataset,
  category: QueryCategory,
): QADataset {
  const filtered = dataset.items.filter((item) => item.category === category);
  return {
    ...dataset,
    name: `${dataset.name}-${category}`,
    items: filtered,
    count: filtered.length,
  };
}

/**
 * Merge multiple datasets into one.
 */
export function mergeDatasets(datasets: QADataset[], name?: string): QADataset {
  const allItems = datasets.flatMap((d) => d.items);
  return {
    name: name ?? `merged-${Date.now()}`,
    description: `Merged from ${datasets.length} datasets`,
    generatedAt: new Date().toISOString(),
    count: allItems.length,
    items: allItems,
    metadata: {
      corpusDocCount: Math.max(...datasets.map((d) => d.metadata.corpusDocCount)),
      corpusCategories: [...new Set(datasets.flatMap((d) => d.metadata.corpusCategories))],
      generatorModel: datasets[0]?.metadata.generatorModel ?? 'unknown',
    },
  };
}
