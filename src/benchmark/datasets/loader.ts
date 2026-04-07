/**
 * Dataset loader — reads/writes Q&A sets as JSON files.
 *
 * Provides persistent storage of generated Q&A datasets for
 * reproducible benchmark runs.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import type { Query, QueryCategory } from '../../types.ts';
import type { GeneratedQA } from './generator.ts';
import { createLogger } from '../../logger.ts';
import { v4 as uuid } from 'uuid';

const log = createLogger('dataset-loader');

// ── Types ────────────────────────────────────────────────────────

/** Metadata for a saved Q&A dataset. */
export interface DatasetMetadata {
  /** Dataset name */
  name: string;
  /** When the dataset was created */
  createdAt: string;
  /** Number of Q&A items */
  count: number;
  /** Breakdown by category */
  byCategory: Record<string, number>;
  /** Description of the dataset */
  description?: string;
}

/** A persisted Q&A dataset with metadata. */
export interface QADataset {
  /** Dataset metadata */
  metadata: DatasetMetadata;
  /** The Q&A items */
  items: GeneratedQA[];
}

/** Listing of available datasets. */
export interface DatasetInfo {
  /** File name (without path) */
  fileName: string;
  /** Full file path */
  filePath: string;
  /** Dataset metadata (if parseable) */
  metadata?: DatasetMetadata;
}

// ── Default Paths ────────────────────────────────────────────────

/** Default directory for Q&A datasets. */
const DEFAULT_DATASETS_DIR = 'src/benchmark/datasets';

// ── Save/Load Functions ──────────────────────────────────────────

/**
 * Save a Q&A dataset to a JSON file.
 *
 * @param items - Generated Q&A items to save
 * @param name - Name for the dataset
 * @param dir - Directory to save in (defaults to src/benchmark/datasets/)
 * @param description - Optional description
 * @returns The file path where the dataset was saved
 */
export async function saveDataset(
  items: GeneratedQA[],
  name: string,
  dir: string = DEFAULT_DATASETS_DIR,
  description?: string,
): Promise<string> {
  await mkdir(dir, { recursive: true });

  const byCategory: Record<string, number> = {};
  for (const item of items) {
    byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
  }

  const dataset: QADataset = {
    metadata: {
      name,
      createdAt: new Date().toISOString(),
      count: items.length,
      byCategory,
      description,
    },
    items,
  };

  const sanitizedName = name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
  const filePath = join(dir, `${sanitizedName}.json`);

  await writeFile(filePath, JSON.stringify(dataset, null, 2), 'utf-8');
  log.info({ filePath, count: items.length, name }, 'Dataset saved');

  return filePath;
}

/**
 * Load a Q&A dataset from a JSON file.
 *
 * @param filePath - Path to the JSON dataset file
 * @returns The loaded dataset
 */
export async function loadDataset(filePath: string): Promise<QADataset> {
  const raw = await readFile(filePath, 'utf-8');
  const dataset = JSON.parse(raw) as QADataset;

  if (!dataset.metadata || !Array.isArray(dataset.items)) {
    throw new Error(`Invalid dataset format in ${filePath}`);
  }

  log.info({ filePath, count: dataset.items.length }, 'Dataset loaded');
  return dataset;
}

/**
 * List all available datasets in a directory.
 *
 * @param dir - Directory to scan (defaults to src/benchmark/datasets/)
 * @returns Array of dataset info objects
 */
export async function listDatasets(
  dir: string = DEFAULT_DATASETS_DIR,
): Promise<DatasetInfo[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    log.warn({ dir }, 'Dataset directory not found');
    return [];
  }

  const datasets: DatasetInfo[] = [];

  for (const entry of entries) {
    if (extname(entry) !== '.json') continue;

    const filePath = join(dir, entry);
    let metadata: DatasetMetadata | undefined;

    try {
      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.metadata) {
        metadata = parsed.metadata;
      }
    } catch {
      // Skip files that can't be parsed
    }

    datasets.push({
      fileName: entry,
      filePath,
      metadata,
    });
  }

  return datasets;
}

/**
 * Convert GeneratedQA items to Query objects for benchmarking.
 *
 * @param items - Generated Q&A items
 * @returns Array of Query objects suitable for the benchmark runner
 */
export function convertToQueries(items: GeneratedQA[]): Query[] {
  return items.map((item) => ({
    id: item.id,
    text: item.question,
    expectedAnswer: item.groundTruthAnswer,
    category: item.category,
    metadata: {
      sourceDocIds: item.sourceDocumentIds,
      sourceDocTitles: item.sourceDocumentTitles,
      reasoningType: item.reasoningType,
      difficulty: item.difficulty,
    },
  }));
}

/**
 * Load a dataset and convert it to Query objects in one step.
 *
 * @param filePath - Path to the JSON dataset file
 * @returns Array of Query objects
 */
export async function loadDatasetAsQueries(filePath: string): Promise<Query[]> {
  const dataset = await loadDataset(filePath);
  return convertToQueries(dataset.items);
}
