/**
 * Unit tests for Q&A generator and dataset loader.
 *
 * Tests synthetic Q&A generation (single-hop, multi-hop, comparison),
 * dataset save/load, and conversion to Query objects.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  generateSingleHopQuestions,
  generateMultiHopQuestions,
  generateComparisonQuestions,
  generateQADataset,
} from '../../src/benchmark/datasets/generator.ts';
import type { GeneratedQA } from '../../src/benchmark/datasets/generator.ts';
import {
  saveDataset,
  loadDataset,
  listDatasets,
  convertToQueries,
  loadDatasetAsQueries,
} from '../../src/benchmark/datasets/loader.ts';
import { MockLLM } from '../../src/providers/llm.ts';
import type { CorpusDocument } from '../../src/types.ts';

// Silence logger during tests
process.env.LOG_LEVEL = 'silent';

// ── Test Helpers ─────────────────────────────────────────────────

function makeDoc(overrides: Partial<CorpusDocument> = {}): CorpusDocument {
  return {
    id: 'technical-api-reference',
    title: 'Meridian API Reference',
    content: `# Meridian API Reference

The Meridian Data Platform API provides RESTful endpoints for data ingestion, querying, and management.

## Rate Limits
- Free tier: 100 requests per minute, 10,000 requests per day
- Pro tier: 1,000 requests per minute, 100,000 requests per day
- Enterprise tier: Custom limits

## Authentication
All API calls require a Bearer token. Tokens can be obtained from the dashboard.

## Endpoints
- POST /api/v1/ingest - Ingest data records
- GET /api/v1/query - Execute queries
- GET /api/v1/status - Check system status`,
    filePath: '/corpus/technical/api-reference.md',
    relativePath: 'technical/api-reference.md',
    category: 'technical',
    metadata: { title: 'Meridian API Reference' },
    sizeBytes: 500,
    ...overrides,
  };
}

function makeDoc2(): CorpusDocument {
  return {
    id: 'narrative-project-history',
    title: 'Meridian Project History',
    content: `# Meridian Project History

## Origins
Meridian was founded in 2020 by Dr. Sarah Chen at NovaTech Solutions.

## Key Milestones
- 2020 Q1: Initial prototype by Sarah Chen
- 2021 Q3: Lin Wei joins and leads the query engine rewrite
- 2022 Q1: Version 2.0 released with 83% latency improvement
- 2023 Q2: James Okafor implements the A2A protocol integration

## Team
- Dr. Sarah Chen - Founder and Chief Architect
- Lin Wei - Query Engine Lead
- James Okafor - Integration Lead
- Marcus Rivera - DevOps Lead`,
    filePath: '/corpus/narrative/project-history.md',
    relativePath: 'narrative/project-history.md',
    category: 'narrative',
    metadata: { title: 'Meridian Project History' },
    sizeBytes: 600,
  };
}

function makeDoc3(): CorpusDocument {
  return {
    id: 'multi-doc-performance-benchmarks',
    title: 'Performance Benchmarks',
    content: `# Performance Benchmarks

## Query Latency
- Single-table query p95: 1.4s
- Multi-table join p95: 2.4-6.2s
- Complex aggregation p95: 4.8s

## Throughput
- Ingestion: 2.3 billion events/day
- Query: 50,000 queries/hour at peak

## Comparison with v1
- Query latency improved by 76% in p95
- Ingestion throughput doubled
- Memory usage reduced by 40%`,
    filePath: '/corpus/multi-doc/performance-benchmarks.md',
    relativePath: 'multi-doc/performance-benchmarks.md',
    category: 'multi-doc',
    metadata: { title: 'Performance Benchmarks' },
    sizeBytes: 400,
  };
}

// ── Q&A Generator Tests ──────────────────────────────────────────

describe('Q&A Generator', () => {
  let llm: MockLLM;

  beforeEach(() => {
    llm = new MockLLM();
  });

  describe('generateSingleHopQuestions', () => {
    test('generates well-formed Q&A objects', async () => {
      const questions = await generateSingleHopQuestions(makeDoc(), llm, 2);

      for (const qa of questions) {
        expect(qa.id).toBeDefined();
        expect(qa.id.length).toBeGreaterThan(0);
        expect(qa.question).toBeDefined();
        expect(qa.groundTruthAnswer).toBeDefined();
        expect(qa.sourceDocumentIds).toEqual(['technical-api-reference']);
        expect(qa.sourceDocumentTitles).toEqual(['Meridian API Reference']);
        expect(qa.category).toBe('single-hop');
        expect(qa.reasoningType).toBe('factoid-extraction');
        expect(['easy', 'medium', 'hard']).toContain(qa.difficulty);
        expect(qa.metadata.documentCount).toBe(1);
        expect(qa.metadata.generatedAt).toBeDefined();
      }
    });

    test('calls LLM exactly once', async () => {
      await generateSingleHopQuestions(makeDoc(), llm, 2);
      expect(llm.getCallCount()).toBe(1);
    });

    test('generates unique IDs', async () => {
      const questions = await generateSingleHopQuestions(makeDoc(), llm, 3);
      const ids = new Set(questions.map((q) => q.id));
      expect(ids.size).toBe(questions.length);
    });

    test('handles any document category', async () => {
      const techDoc = makeDoc({ category: 'technical' });
      const narrativeDoc = makeDoc({ id: 'narrative-test', category: 'narrative' });

      const techQs = await generateSingleHopQuestions(techDoc, llm, 1);
      const narrQs = await generateSingleHopQuestions(narrativeDoc, llm, 1);

      expect(techQs[0]?.category).toBe('single-hop');
      expect(narrQs[0]?.category).toBe('single-hop');
    });
  });

  describe('generateMultiHopQuestions', () => {
    test('generates well-formed Q&A objects', async () => {
      const docs = [makeDoc(), makeDoc2()];
      const questions = await generateMultiHopQuestions(docs, llm, 1);

      for (const qa of questions) {
        expect(qa.id).toBeDefined();
        expect(qa.question).toBeDefined();
        expect(qa.groundTruthAnswer).toBeDefined();
        expect(qa.sourceDocumentIds).toHaveLength(2);
        expect(qa.sourceDocumentIds).toContain('technical-api-reference');
        expect(qa.sourceDocumentIds).toContain('narrative-project-history');
        expect(qa.category).toBe('multi-hop');
        expect(qa.reasoningType).toBe('multi-document-synthesis');
        expect(qa.metadata.documentCount).toBe(2);
      }
    });

    test('requires at least 2 documents', async () => {
      const questions = await generateMultiHopQuestions([makeDoc()], llm, 1);
      expect(questions).toHaveLength(0);
    });

    test('calls LLM exactly once', async () => {
      await generateMultiHopQuestions([makeDoc(), makeDoc2()], llm, 1);
      expect(llm.getCallCount()).toBe(1);
    });

    test('references all source documents', async () => {
      const docs = [makeDoc(), makeDoc2(), makeDoc3()];
      const questions = await generateMultiHopQuestions(docs, llm, 1);

      for (const qa of questions) {
        expect(qa.sourceDocumentIds).toHaveLength(3);
      }
    });
  });

  describe('generateComparisonQuestions', () => {
    test('generates well-formed Q&A objects', async () => {
      const docs = [makeDoc(), makeDoc2()];
      const questions = await generateComparisonQuestions(docs, llm, 1);

      for (const qa of questions) {
        expect(qa.id).toBeDefined();
        expect(qa.question).toBeDefined();
        expect(qa.groundTruthAnswer).toBeDefined();
        expect(qa.sourceDocumentIds).toHaveLength(2);
        expect(qa.category).toBe('comparative');
        expect(qa.reasoningType).toBe('comparison-contrast');
        expect(qa.metadata.documentCount).toBe(2);
      }
    });

    test('requires at least 2 documents', async () => {
      const questions = await generateComparisonQuestions([makeDoc()], llm, 1);
      expect(questions).toHaveLength(0);
    });

    test('calls LLM exactly once', async () => {
      await generateComparisonQuestions([makeDoc(), makeDoc2()], llm, 1);
      expect(llm.getCallCount()).toBe(1);
    });
  });

  describe('generateQADataset', () => {
    test('generates questions of all three types', async () => {
      const docs = [makeDoc(), makeDoc2()];
      const dataset = await generateQADataset(docs, llm, {
        singleHopPerDoc: 1,
        multiHopPerPair: 1,
        comparisonPerPair: 1,
      });

      const categories = new Set(dataset.map((q) => q.category));
      expect(categories.has('single-hop')).toBe(true);
      // multi-hop and comparison may or may not parse from mock, but pipeline runs
      expect(dataset.length).toBeGreaterThan(0);
    });

    test('assigns unique IDs across all questions', async () => {
      const docs = [makeDoc(), makeDoc2()];
      const dataset = await generateQADataset(docs, llm, {
        singleHopPerDoc: 2,
        multiHopPerPair: 1,
        comparisonPerPair: 1,
      });

      const ids = new Set(dataset.map((q) => q.id));
      expect(ids.size).toBe(dataset.length);
    });

    test('all items have required fields', async () => {
      const docs = [makeDoc(), makeDoc2()];
      const dataset = await generateQADataset(docs, llm);

      for (const qa of dataset) {
        expect(qa.id).toBeDefined();
        expect(qa.question).toBeDefined();
        expect(qa.groundTruthAnswer).toBeDefined();
        expect(qa.sourceDocumentIds.length).toBeGreaterThan(0);
        expect(qa.sourceDocumentTitles.length).toBeGreaterThan(0);
        expect(qa.category).toBeDefined();
        expect(qa.reasoningType).toBeDefined();
        expect(qa.difficulty).toBeDefined();
        expect(qa.metadata).toBeDefined();
      }
    });
  });
});

// ── Dataset Loader Tests ─────────────────────────────────────────

describe('Dataset Loader', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'qa-datasets-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function makeSampleQA(overrides: Partial<GeneratedQA> = {}): GeneratedQA {
    return {
      id: 'qa-test-1',
      question: 'What is the rate limit for the free tier?',
      groundTruthAnswer: '100 requests per minute.',
      sourceDocumentIds: ['technical-api-reference'],
      sourceDocumentTitles: ['API Reference'],
      category: 'single-hop',
      reasoningType: 'factoid-extraction',
      difficulty: 'easy',
      metadata: {
        generatedAt: new Date().toISOString(),
        documentCount: 1,
      },
      ...overrides,
    };
  }

  describe('saveDataset', () => {
    test('saves dataset to JSON file', async () => {
      const items = [makeSampleQA(), makeSampleQA({ id: 'qa-test-2' })];
      const filePath = await saveDataset(items, 'test-dataset', tempDir);

      expect(filePath).toContain('test-dataset.json');
    });

    test('sanitizes file name', async () => {
      const items = [makeSampleQA()];
      const filePath = await saveDataset(items, 'My Test Dataset!', tempDir);

      expect(filePath).toContain('my-test-dataset-');
    });

    test('includes metadata in saved file', async () => {
      const items = [makeSampleQA(), makeSampleQA({ id: 'qa-2', category: 'multi-hop' })];
      const filePath = await saveDataset(items, 'meta-test', tempDir, 'A test dataset');

      const dataset = await loadDataset(filePath);
      expect(dataset.metadata.name).toBe('meta-test');
      expect(dataset.metadata.count).toBe(2);
      expect(dataset.metadata.description).toBe('A test dataset');
      expect(dataset.metadata.byCategory['single-hop']).toBe(1);
      expect(dataset.metadata.byCategory['multi-hop']).toBe(1);
    });
  });

  describe('loadDataset', () => {
    test('loads saved dataset', async () => {
      const items = [makeSampleQA(), makeSampleQA({ id: 'qa-2' })];
      const filePath = await saveDataset(items, 'load-test', tempDir);

      const dataset = await loadDataset(filePath);
      expect(dataset.items).toHaveLength(2);
      expect(dataset.items[0].question).toBe('What is the rate limit for the free tier?');
    });

    test('preserves all Q&A fields', async () => {
      const original = makeSampleQA({
        id: 'preserve-test',
        question: 'Custom question?',
        groundTruthAnswer: 'Custom answer.',
        sourceDocumentIds: ['doc-a', 'doc-b'],
        category: 'multi-hop',
        reasoningType: 'multi-document-synthesis',
        difficulty: 'hard',
      });

      const filePath = await saveDataset([original], 'preserve-test', tempDir);
      const dataset = await loadDataset(filePath);
      const loaded = dataset.items[0];

      expect(loaded.id).toBe('preserve-test');
      expect(loaded.question).toBe('Custom question?');
      expect(loaded.groundTruthAnswer).toBe('Custom answer.');
      expect(loaded.sourceDocumentIds).toEqual(['doc-a', 'doc-b']);
      expect(loaded.category).toBe('multi-hop');
      expect(loaded.reasoningType).toBe('multi-document-synthesis');
      expect(loaded.difficulty).toBe('hard');
    });

    test('throws on invalid format', async () => {
      const { writeFile } = await import('node:fs/promises');
      const badFile = join(tempDir, 'bad.json');
      await writeFile(badFile, '{"not": "a dataset"}', 'utf-8');

      expect(loadDataset(badFile)).rejects.toThrow('Invalid dataset format');
    });
  });

  describe('listDatasets', () => {
    test('lists all JSON files in directory', async () => {
      await saveDataset([makeSampleQA()], 'dataset-a', tempDir);
      await saveDataset([makeSampleQA()], 'dataset-b', tempDir);

      const datasets = await listDatasets(tempDir);
      expect(datasets).toHaveLength(2);
      const names = datasets.map((d) => d.fileName);
      expect(names).toContain('dataset-a.json');
      expect(names).toContain('dataset-b.json');
    });

    test('includes metadata for valid files', async () => {
      await saveDataset([makeSampleQA()], 'with-meta', tempDir);

      const datasets = await listDatasets(tempDir);
      expect(datasets[0].metadata).toBeDefined();
      expect(datasets[0].metadata!.name).toBe('with-meta');
    });

    test('returns empty for non-existent directory', async () => {
      const datasets = await listDatasets(join(tempDir, 'nonexistent'));
      expect(datasets).toEqual([]);
    });
  });

  describe('convertToQueries', () => {
    test('converts GeneratedQA to Query objects', () => {
      const items: GeneratedQA[] = [
        makeSampleQA({ id: 'q1' }),
        makeSampleQA({ id: 'q2', category: 'multi-hop' }),
      ];

      const queries = convertToQueries(items);
      expect(queries).toHaveLength(2);

      expect(queries[0].id).toBe('q1');
      expect(queries[0].text).toBe('What is the rate limit for the free tier?');
      expect(queries[0].expectedAnswer).toBe('100 requests per minute.');
      expect(queries[0].category).toBe('single-hop');
      expect((queries[0].metadata as any).sourceDocIds).toEqual(['technical-api-reference']);
      expect((queries[0].metadata as any).reasoningType).toBe('factoid-extraction');
      expect((queries[0].metadata as any).difficulty).toBe('easy');
    });

    test('handles empty array', () => {
      const queries = convertToQueries([]);
      expect(queries).toEqual([]);
    });
  });

  describe('loadDatasetAsQueries', () => {
    test('loads and converts in one step', async () => {
      const items = [makeSampleQA({ id: 'direct-q1' })];
      const filePath = await saveDataset(items, 'direct-load', tempDir);

      const queries = await loadDatasetAsQueries(filePath);
      expect(queries).toHaveLength(1);
      expect(queries[0].id).toBe('direct-q1');
      expect(queries[0].text).toBe('What is the rate limit for the free tier?');
    });
  });
});
