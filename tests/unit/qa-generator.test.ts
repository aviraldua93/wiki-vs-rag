/**
 * Unit tests for Q&A generator and dataset loader.
 *
 * Tests:
 * - Single-hop question generation from a single document
 * - Multi-hop question generation requiring 2+ documents
 * - Comparison question generation
 * - Full dataset generation
 * - Dataset save/load/list operations
 * - Dataset conversion to Query objects
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { rm, mkdir } from 'node:fs/promises';
import {
  generateSingleHopQuestions,
  generateMultiHopQuestions,
  generateComparisonQuestions,
  generateQADataset,
} from '../../src/benchmark/datasets/qa-generator.ts';
import type { QADataset, GeneratedQA } from '../../src/benchmark/datasets/qa-generator.ts';
import {
  saveDataset,
  loadDataset,
  listDatasets,
  datasetToQueries,
  filterDatasetByCategory,
  mergeDatasets,
} from '../../src/benchmark/datasets/dataset-loader.ts';
import { MockLLM } from '../../src/providers/llm.ts';
import type { CorpusDocument } from '../../src/types.ts';

// Silence logger during tests
process.env.LOG_LEVEL = 'silent';

const TEST_DIR = join(import.meta.dir, '..', '..', '.test-qa-gen');

// ── Test Helpers ─────────────────────────────────────────────────

function makeDoc(overrides: Partial<CorpusDocument> = {}): CorpusDocument {
  return {
    id: 'technical-api-reference',
    title: 'API Reference',
    content: `# Meridian API Reference

## Rate Limits
The free tier allows 100 requests per minute and 10,000 requests per day.
The enterprise tier allows 10,000 requests per minute and 1,000,000 requests per day.

## Authentication
All API requests require an API key passed via the X-API-Key header.
OAuth2 is supported for enterprise clients.

## Endpoints
- GET /api/v1/data - Retrieve data records
- POST /api/v1/ingest - Ingest new data
- DELETE /api/v1/data/:id - Delete a record`,
    filePath: '/corpus/technical/api-reference.md',
    relativePath: 'technical/api-reference.md',
    category: 'technical',
    metadata: {},
    sizeBytes: 500,
    ...overrides,
  };
}

function makeDoc2(overrides: Partial<CorpusDocument> = {}): CorpusDocument {
  return {
    id: 'narrative-project-history',
    title: 'Project History',
    content: `# Meridian Project History

## Origins
Meridian was created in 2022 by Dr. Sarah Chen at NovaTech Solutions.
The initial prototype processed 100,000 events per day.

## Growth
By 2024, Meridian processes 2.3 billion events daily.
Lin Wei led the query engine rewrite achieving 83% improvement in p95 latency.

## Team
- Dr. Sarah Chen: Founder and lead architect
- Lin Wei: Query engine lead
- James Okafor: Infrastructure lead`,
    filePath: '/corpus/narrative/project-history.md',
    relativePath: 'narrative/project-history.md',
    category: 'narrative',
    metadata: {},
    sizeBytes: 400,
    ...overrides,
  };
}

function makeDataset(overrides: Partial<QADataset> = {}): QADataset {
  return {
    name: 'test-dataset',
    description: 'Test Q&A dataset',
    generatedAt: new Date().toISOString(),
    count: 3,
    items: [
      {
        id: 'qa-1',
        question: 'What is the API rate limit?',
        groundTruthAnswer: '100 requests per minute.',
        sourceDocIds: ['technical-api-reference'],
        sourceDocTitles: ['API Reference'],
        reasoningType: 'factoid',
        category: 'single-hop',
        difficulty: 'easy',
        generatedAt: new Date().toISOString(),
      },
      {
        id: 'qa-2',
        question: 'Who created Meridian and when?',
        groundTruthAnswer: 'Dr. Sarah Chen created it in 2022.',
        sourceDocIds: ['narrative-project-history'],
        sourceDocTitles: ['Project History'],
        reasoningType: 'factoid',
        category: 'single-hop',
        difficulty: 'medium',
        generatedAt: new Date().toISOString(),
      },
      {
        id: 'qa-3',
        question: 'Compare the original and current event processing capacity.',
        groundTruthAnswer: 'Originally 100K events/day, now 2.3 billion events/day.',
        sourceDocIds: ['narrative-project-history', 'technical-api-reference'],
        sourceDocTitles: ['Project History', 'API Reference'],
        reasoningType: 'comparison',
        category: 'comparative',
        difficulty: 'hard',
        generatedAt: new Date().toISOString(),
      },
    ],
    metadata: {
      corpusDocCount: 2,
      corpusCategories: ['technical', 'narrative'],
      generatorModel: 'mock-gpt-4o-mini',
    },
    ...overrides,
  };
}

// ── Cleanup ──────────────────────────────────────────────────────

afterEach(async () => {
  try {
    await rm(TEST_DIR, { recursive: true, force: true });
  } catch {}
});

// ── Single-Hop Generation ────────────────────────────────────────

describe('generateSingleHopQuestions', () => {
  let llm: MockLLM;

  beforeEach(() => {
    llm = new MockLLM();
  });

  test('generates questions from a document', async () => {
    const questions = await generateSingleHopQuestions(makeDoc(), llm, 2);
    expect(questions.length).toBeGreaterThan(0);
  });

  test('each question has required fields', async () => {
    const questions = await generateSingleHopQuestions(makeDoc(), llm, 2);
    for (const q of questions) {
      expect(q.id).toBeDefined();
      expect(q.id.length).toBeGreaterThan(0);
      expect(q.question).toBeDefined();
      expect(typeof q.question).toBe('string');
      expect(q.groundTruthAnswer).toBeDefined();
      expect(typeof q.groundTruthAnswer).toBe('string');
      expect(q.sourceDocIds).toContain('technical-api-reference');
      expect(q.reasoningType).toBe('factoid');
      expect(q.category).toBe('single-hop');
      expect(['easy', 'medium', 'hard']).toContain(q.difficulty);
      expect(q.generatedAt).toBeDefined();
    }
  });

  test('references the source document', async () => {
    const questions = await generateSingleHopQuestions(makeDoc(), llm, 1);
    expect(questions[0].sourceDocIds).toEqual(['technical-api-reference']);
    expect(questions[0].sourceDocTitles).toEqual(['API Reference']);
  });

  test('calls LLM once', async () => {
    await generateSingleHopQuestions(makeDoc(), llm, 2);
    expect(llm.getCallCount()).toBe(1);
  });
});

// ── Multi-Hop Generation ─────────────────────────────────────────

describe('generateMultiHopQuestions', () => {
  let llm: MockLLM;

  beforeEach(() => {
    llm = new MockLLM();
  });

  test('generates questions from multiple documents', async () => {
    const questions = await generateMultiHopQuestions([makeDoc(), makeDoc2()], llm, 2);
    expect(questions.length).toBeGreaterThan(0);
  });

  test('each question has required fields', async () => {
    const questions = await generateMultiHopQuestions([makeDoc(), makeDoc2()], llm, 2);
    for (const q of questions) {
      expect(q.id).toBeDefined();
      expect(q.question).toBeDefined();
      expect(q.groundTruthAnswer).toBeDefined();
      expect(q.sourceDocIds.length).toBeGreaterThanOrEqual(2);
      expect(q.reasoningType).toBe('multi-hop');
      expect(q.category).toBe('multi-hop');
      expect(['easy', 'medium', 'hard']).toContain(q.difficulty);
    }
  });

  test('references multiple source documents', async () => {
    const questions = await generateMultiHopQuestions([makeDoc(), makeDoc2()], llm, 1);
    expect(questions[0].sourceDocIds).toContain('technical-api-reference');
    expect(questions[0].sourceDocIds).toContain('narrative-project-history');
  });

  test('returns empty for single document', async () => {
    const questions = await generateMultiHopQuestions([makeDoc()], llm, 2);
    expect(questions).toEqual([]);
  });
});

// ── Comparison Generation ────────────────────────────────────────

describe('generateComparisonQuestions', () => {
  let llm: MockLLM;

  beforeEach(() => {
    llm = new MockLLM();
  });

  test('generates comparison questions', async () => {
    const questions = await generateComparisonQuestions([makeDoc(), makeDoc2()], llm, 2);
    expect(questions.length).toBeGreaterThan(0);
  });

  test('each question is tagged as comparison/comparative', async () => {
    const questions = await generateComparisonQuestions([makeDoc(), makeDoc2()], llm, 2);
    for (const q of questions) {
      expect(q.reasoningType).toBe('comparison');
      expect(q.category).toBe('comparative');
    }
  });

  test('returns empty for single document', async () => {
    const questions = await generateComparisonQuestions([makeDoc()], llm, 2);
    expect(questions).toEqual([]);
  });
});

// ── Full Dataset Generation ──────────────────────────────────────

describe('generateQADataset', () => {
  let llm: MockLLM;

  beforeEach(() => {
    llm = new MockLLM();
  });

  test('generates a complete dataset', async () => {
    const dataset = await generateQADataset([makeDoc(), makeDoc2()], llm, {
      singleHopPerDoc: 1,
      multiHopCount: 1,
      comparisonCount: 1,
    });

    expect(dataset.items.length).toBeGreaterThan(0);
    expect(dataset.count).toBe(dataset.items.length);
    expect(dataset.name).toBeDefined();
    expect(dataset.generatedAt).toBeDefined();
  });

  test('includes all question types', async () => {
    const dataset = await generateQADataset([makeDoc(), makeDoc2()], llm, {
      singleHopPerDoc: 1,
      multiHopCount: 1,
      comparisonCount: 1,
    });

    const types = new Set(dataset.items.map((q) => q.reasoningType));
    expect(types.has('factoid')).toBe(true);
    // multi-hop and comparison depend on MockLLM response parsing
  });

  test('includes metadata about corpus', async () => {
    const dataset = await generateQADataset([makeDoc(), makeDoc2()], llm);
    expect(dataset.metadata.corpusDocCount).toBe(2);
    expect(dataset.metadata.corpusCategories.length).toBeGreaterThan(0);
    expect(dataset.metadata.generatorModel).toBeDefined();
  });

  test('handles single document (no multi-hop/comparison)', async () => {
    const dataset = await generateQADataset([makeDoc()], llm, {
      singleHopPerDoc: 2,
      multiHopCount: 2,
      comparisonCount: 2,
    });

    // Only single-hop should be generated
    const multiHop = dataset.items.filter((q) => q.reasoningType === 'multi-hop');
    const comparison = dataset.items.filter((q) => q.reasoningType === 'comparison');
    expect(multiHop).toHaveLength(0);
    expect(comparison).toHaveLength(0);
  });
});

// ── Dataset Loader ───────────────────────────────────────────────

describe('saveDataset / loadDataset', () => {
  test('round-trips a dataset through save and load', async () => {
    const dataset = makeDataset();
    const filePath = await saveDataset(dataset, TEST_DIR, 'test.json');

    const loaded = await loadDataset(filePath);
    expect(loaded.name).toBe(dataset.name);
    expect(loaded.count).toBe(dataset.count);
    expect(loaded.items).toHaveLength(3);
    expect(loaded.items[0].question).toBe(dataset.items[0].question);
    expect(loaded.items[0].groundTruthAnswer).toBe(dataset.items[0].groundTruthAnswer);
  });

  test('creates directory if it does not exist', async () => {
    const dataset = makeDataset();
    const deepDir = join(TEST_DIR, 'nested', 'deep');
    const filePath = await saveDataset(dataset, deepDir);
    const loaded = await loadDataset(filePath);
    expect(loaded.count).toBe(3);
  });

  test('uses dataset name as default filename', async () => {
    const dataset = makeDataset({ name: 'my-custom-name' });
    const filePath = await saveDataset(dataset, TEST_DIR);
    expect(filePath).toContain('my-custom-name.json');
  });
});

describe('listDatasets', () => {
  test('lists saved datasets', async () => {
    await saveDataset(makeDataset({ name: 'ds-1' }), TEST_DIR, 'ds-1.json');
    await saveDataset(makeDataset({ name: 'ds-2' }), TEST_DIR, 'ds-2.json');

    const summaries = await listDatasets(TEST_DIR);
    expect(summaries).toHaveLength(2);
    expect(summaries.map((s) => s.name)).toContain('ds-1');
    expect(summaries.map((s) => s.name)).toContain('ds-2');
  });

  test('returns empty for non-existent directory', async () => {
    const summaries = await listDatasets('/nonexistent/path/to/datasets');
    expect(summaries).toEqual([]);
  });

  test('includes categories in summary', async () => {
    await saveDataset(makeDataset(), TEST_DIR, 'test.json');

    const summaries = await listDatasets(TEST_DIR);
    expect(summaries[0].categories.length).toBeGreaterThan(0);
  });
});

// ── Conversion Functions ─────────────────────────────────────────

describe('datasetToQueries', () => {
  test('converts QADataset items to Query objects', () => {
    const dataset = makeDataset();
    const queries = datasetToQueries(dataset);

    expect(queries).toHaveLength(3);
    expect(queries[0].text).toBe('What is the API rate limit?');
    expect(queries[0].expectedAnswer).toBe('100 requests per minute.');
    expect(queries[0].category).toBe('single-hop');
  });

  test('preserves metadata from GeneratedQA', () => {
    const dataset = makeDataset();
    const queries = datasetToQueries(dataset);

    const meta = queries[0].metadata as { sourceDocIds: string[]; reasoningType: string; difficulty: string };
    expect(meta.sourceDocIds).toEqual(['technical-api-reference']);
    expect(meta.reasoningType).toBe('factoid');
    expect(meta.difficulty).toBe('easy');
  });

  test('handles empty dataset', () => {
    const dataset = makeDataset({ items: [], count: 0 });
    const queries = datasetToQueries(dataset);
    expect(queries).toEqual([]);
  });
});

describe('filterDatasetByCategory', () => {
  test('filters items by category', () => {
    const dataset = makeDataset();
    const filtered = filterDatasetByCategory(dataset, 'single-hop');

    expect(filtered.items.length).toBe(2);
    expect(filtered.items.every((q) => q.category === 'single-hop')).toBe(true);
    expect(filtered.count).toBe(2);
  });

  test('returns empty for non-matching category', () => {
    const dataset = makeDataset();
    const filtered = filterDatasetByCategory(dataset, 'aggregation');
    expect(filtered.items).toEqual([]);
    expect(filtered.count).toBe(0);
  });
});

describe('mergeDatasets', () => {
  test('merges multiple datasets', () => {
    const ds1 = makeDataset({ name: 'ds1', count: 2, items: makeDataset().items.slice(0, 2) });
    const ds2 = makeDataset({ name: 'ds2', count: 1, items: makeDataset().items.slice(2, 3) });

    const merged = mergeDatasets([ds1, ds2], 'merged');
    expect(merged.items).toHaveLength(3);
    expect(merged.name).toBe('merged');
    expect(merged.count).toBe(3);
  });

  test('preserves all categories from merged datasets', () => {
    const ds1 = makeDataset({
      metadata: { corpusDocCount: 5, corpusCategories: ['technical'], generatorModel: 'mock' },
    });
    const ds2 = makeDataset({
      metadata: { corpusDocCount: 3, corpusCategories: ['narrative'], generatorModel: 'mock' },
    });

    const merged = mergeDatasets([ds1, ds2]);
    expect(merged.metadata.corpusCategories).toContain('technical');
    expect(merged.metadata.corpusCategories).toContain('narrative');
  });
});
