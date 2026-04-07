/**
 * Synthetic Q&A dataset generation from corpus.
 */

import type { Query, QueryCategory, CorpusDocument, LLMProvider, ChatMessage } from '../../types.ts';
import { createLogger } from '../../logger.ts';
import { v4 as uuid } from 'uuid';

const log = createLogger('datasets');

/** A pre-built Q&A pair for benchmarking. */
export interface QAPair {
  question: string;
  expectedAnswer: string;
  category: QueryCategory;
  sourceDocIds: string[];
}

/**
 * Generate a set of benchmark queries from Q&A pairs.
 */
export function queriesToBenchmark(pairs: QAPair[]): Query[] {
  return pairs.map((pair) => ({
    id: uuid(),
    text: pair.question,
    expectedAnswer: pair.expectedAnswer,
    category: pair.category,
    metadata: { sourceDocIds: pair.sourceDocIds },
  }));
}

/**
 * Create a minimal set of test queries for quick benchmarks.
 */
export function createTestQueries(): Query[] {
  return queriesToBenchmark([
    {
      question: 'What is the default rate limit for the Meridian API free tier?',
      expectedAnswer: '100 requests per minute and 10,000 requests per day.',
      category: 'single-hop',
      sourceDocIds: ['technical-api-reference'],
    },
    {
      question: 'Who led the Meridian 3.0 query engine rewrite and what was the performance improvement?',
      expectedAnswer: 'Lin Wei led the rewrite, achieving an 83% improvement in p95 query latency from 8.2s to 1.4s.',
      category: 'multi-hop',
      sourceDocIds: ['technical-system-architecture', 'narrative-project-history'],
    },
    {
      question: 'How did the recommended max_poll_records for Kafka change between Meridian 2.x and 3.x?',
      expectedAnswer: 'The recommendation changed from 500 (default in 2.x) to 2000 based on Q1 2025 benchmarks showing 35% throughput improvement.',
      category: 'temporal',
      sourceDocIds: ['evolving-best-practices', 'multi-doc-performance-benchmarks'],
    },
    {
      question: 'Compare the query latency improvements between GlobalRetail case study results and the official performance benchmarks.',
      expectedAnswer: 'GlobalRetail saw a 76% reduction in p95 query latency (18.3s to 4.4s). The official benchmarks show p95 at 1.4s for single-table queries but 2.4-6.2s for multi-table joins.',
      category: 'comparative',
      sourceDocIds: ['narrative-globalretail-case-study', 'multi-doc-performance-benchmarks'],
    },
    {
      question: 'How many total people and organizations are mentioned across all Meridian documentation?',
      expectedAnswer: 'At least 6 key people (Dr. Sarah Chen, James Okafor, Lin Wei, Marcus Rivera, Priya Sharma, David Park) and organizations including NovaTech Solutions and GlobalRetail.',
      category: 'aggregation',
      sourceDocIds: ['narrative-project-history', 'narrative-globalretail-case-study'],
    },
  ]);
}
