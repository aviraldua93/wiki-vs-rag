/**
 * Synthetic Q&A generator — uses LLM to generate benchmark questions
 * from corpus documents.
 *
 * Generates three types of questions:
 * - Single-hop factoid: answerable from a single document
 * - Multi-hop reasoning: requires synthesizing 2+ documents
 * - Comparison: contrasting information from different documents
 *
 * Each Q&A includes question, ground-truth answer, source documents,
 * reasoning type tag, and difficulty level.
 */

import type {
  CorpusDocument,
  LLMProvider,
  ChatMessage,
  QueryCategory,
} from '../../types.ts';
import { createLogger } from '../../logger.ts';
import { v4 as uuid } from 'uuid';

const log = createLogger('qa-generator');

// ── Types ────────────────────────────────────────────────────────

/** Difficulty levels for generated questions. */
export type DifficultyLevel = 'easy' | 'medium' | 'hard';

/** Reasoning type tag for a generated question. */
export type ReasoningType =
  | 'factoid-extraction'
  | 'multi-document-synthesis'
  | 'comparison-contrast'
  | 'temporal-reasoning'
  | 'aggregation';

/** A generated Q&A item with full metadata. */
export interface GeneratedQA {
  /** Unique identifier */
  id: string;
  /** The generated question */
  question: string;
  /** Ground-truth answer */
  groundTruthAnswer: string;
  /** Source document IDs used to generate this Q&A */
  sourceDocumentIds: string[];
  /** Source document titles */
  sourceDocumentTitles: string[];
  /** Category matching QueryCategory */
  category: QueryCategory;
  /** Reasoning type tag */
  reasoningType: ReasoningType;
  /** Difficulty level */
  difficulty: DifficultyLevel;
  /** Metadata about the generation */
  metadata: {
    generatedAt: string;
    documentCount: number;
  };
}

/** Options for Q&A generation. */
export interface QAGeneratorOptions {
  /** Number of single-hop questions to generate per document */
  singleHopPerDoc?: number;
  /** Number of multi-hop questions to generate per document pair */
  multiHopPerPair?: number;
  /** Number of comparison questions to generate per document pair */
  comparisonPerPair?: number;
  /** Maximum number of documents to combine for multi-hop questions */
  maxDocsForMultiHop?: number;
  /** LLM model to use */
  model?: string;
}

const DEFAULT_OPTIONS: Required<QAGeneratorOptions> = {
  singleHopPerDoc: 2,
  multiHopPerPair: 1,
  comparisonPerPair: 1,
  maxDocsForMultiHop: 3,
  model: 'gpt-4o-mini',
};

// ── Prompts ──────────────────────────────────────────────────────

const SINGLE_HOP_SYSTEM = `You are a question generation expert. Given a document, generate factoid questions that can be answered directly from the text.

For each question, provide:
1. A specific, clear question
2. The exact answer from the document
3. A difficulty rating (easy/medium/hard)

You MUST respond with valid JSON array:
[
  {
    "question": "<specific factoid question>",
    "answer": "<exact answer from the text>",
    "difficulty": "easy|medium|hard"
  }
]`;

const MULTI_HOP_SYSTEM = `You are a question generation expert. Given multiple documents, generate questions that REQUIRE information from at least 2 documents to answer correctly. The question should not be answerable from any single document alone.

For each question, provide:
1. A question requiring synthesis across documents
2. The complete answer combining information from multiple documents
3. A difficulty rating (easy/medium/hard)

You MUST respond with valid JSON array:
[
  {
    "question": "<multi-hop question requiring multiple documents>",
    "answer": "<answer synthesizing information from multiple documents>",
    "difficulty": "easy|medium|hard"
  }
]`;

const COMPARISON_SYSTEM = `You are a question generation expert. Given multiple documents, generate comparison questions that ask the reader to contrast, compare, or evaluate differences between information in the documents.

For each question, provide:
1. A comparison question highlighting differences or similarities
2. The complete answer with the comparison
3. A difficulty rating (easy/medium/hard)

You MUST respond with valid JSON array:
[
  {
    "question": "<comparison question contrasting information>",
    "answer": "<answer comparing/contrasting the information>",
    "difficulty": "easy|medium|hard"
  }
]`;

// ── Generator Functions ──────────────────────────────────────────

/** Parse LLM response into Q&A items, with error handling. */
function parseLLMQAResponse(content: string): Array<{ question: string; answer: string; difficulty: string }> {
  try {
    const parsed = JSON.parse(content);
    // Handle plain array format
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item: any) =>
          typeof item.question === 'string' &&
          typeof item.answer === 'string' &&
          item.question.length > 0 &&
          item.answer.length > 0,
      );
    }
    // Handle wrapped format: {questions: [...]}
    if (parsed.questions && Array.isArray(parsed.questions)) {
      return parsed.questions.filter(
        (item: any) =>
          typeof item.question === 'string' &&
          typeof item.answer === 'string' &&
          item.question.length > 0 &&
          item.answer.length > 0,
      );
    }
    // If single object with question/answer, wrap in array
    if (parsed.question && parsed.answer) {
      return [parsed];
    }
    return [];
  } catch {
    log.warn({ content: content.slice(0, 200) }, 'Failed to parse Q&A response');
    return [];
  }
}

/** Validate difficulty level with fallback. */
function normalizeDifficulty(d: string): DifficultyLevel {
  const normalized = d?.toLowerCase().trim();
  if (normalized === 'easy' || normalized === 'medium' || normalized === 'hard') {
    return normalized;
  }
  return 'medium';
}

/**
 * Generate single-hop factoid questions from a single document.
 */
export async function generateSingleHopQuestions(
  doc: CorpusDocument,
  llm: LLMProvider,
  count: number = 2,
  model?: string,
): Promise<GeneratedQA[]> {
  log.info({ docId: doc.id, count }, 'Generating single-hop questions');

  const messages: ChatMessage[] = [
    { role: 'system', content: SINGLE_HOP_SYSTEM },
    {
      role: 'user',
      content: `Generate ${count} factoid questions from this document:\n\nTitle: ${doc.title}\n\n${doc.content.slice(0, 4000)}`,
    },
  ];

  const response = await llm.complete(messages, {
    model,
    responseFormat: 'json',
    temperature: 0.7,
  });

  const items = parseLLMQAResponse(response.content);

  return items.slice(0, count).map((item) => ({
    id: uuid(),
    question: item.question,
    groundTruthAnswer: item.answer,
    sourceDocumentIds: [doc.id],
    sourceDocumentTitles: [doc.title],
    category: 'single-hop' as QueryCategory,
    reasoningType: 'factoid-extraction' as ReasoningType,
    difficulty: normalizeDifficulty(item.difficulty),
    metadata: {
      generatedAt: new Date().toISOString(),
      documentCount: 1,
    },
  }));
}

/**
 * Generate multi-hop reasoning questions requiring 2+ documents.
 */
export async function generateMultiHopQuestions(
  docs: CorpusDocument[],
  llm: LLMProvider,
  count: number = 1,
  model?: string,
): Promise<GeneratedQA[]> {
  if (docs.length < 2) {
    log.warn('Need at least 2 documents for multi-hop questions');
    return [];
  }

  log.info({ docCount: docs.length, count }, 'Generating multi-hop questions');

  const docSummaries = docs
    .map((d, i) => `--- Document ${i + 1}: ${d.title} ---\n${d.content.slice(0, 2000)}`)
    .join('\n\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: MULTI_HOP_SYSTEM },
    {
      role: 'user',
      content: `Generate ${count} multi-hop questions requiring information from at least 2 of these documents:\n\n${docSummaries}`,
    },
  ];

  const response = await llm.complete(messages, {
    model,
    responseFormat: 'json',
    temperature: 0.7,
  });

  const items = parseLLMQAResponse(response.content);

  return items.slice(0, count).map((item) => ({
    id: uuid(),
    question: item.question,
    groundTruthAnswer: item.answer,
    sourceDocumentIds: docs.map((d) => d.id),
    sourceDocumentTitles: docs.map((d) => d.title),
    category: 'multi-hop' as QueryCategory,
    reasoningType: 'multi-document-synthesis' as ReasoningType,
    difficulty: normalizeDifficulty(item.difficulty),
    metadata: {
      generatedAt: new Date().toISOString(),
      documentCount: docs.length,
    },
  }));
}

/**
 * Generate comparison questions contrasting information from documents.
 */
export async function generateComparisonQuestions(
  docs: CorpusDocument[],
  llm: LLMProvider,
  count: number = 1,
  model?: string,
): Promise<GeneratedQA[]> {
  if (docs.length < 2) {
    log.warn('Need at least 2 documents for comparison questions');
    return [];
  }

  log.info({ docCount: docs.length, count }, 'Generating comparison questions');

  const docSummaries = docs
    .map((d, i) => `--- Document ${i + 1}: ${d.title} ---\n${d.content.slice(0, 2000)}`)
    .join('\n\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: COMPARISON_SYSTEM },
    {
      role: 'user',
      content: `Generate ${count} comparison questions contrasting information from these documents:\n\n${docSummaries}`,
    },
  ];

  const response = await llm.complete(messages, {
    model,
    responseFormat: 'json',
    temperature: 0.7,
  });

  const items = parseLLMQAResponse(response.content);

  return items.slice(0, count).map((item) => ({
    id: uuid(),
    question: item.question,
    groundTruthAnswer: item.answer,
    sourceDocumentIds: docs.map((d) => d.id),
    sourceDocumentTitles: docs.map((d) => d.title),
    category: 'comparative' as QueryCategory,
    reasoningType: 'comparison-contrast' as ReasoningType,
    difficulty: normalizeDifficulty(item.difficulty),
    metadata: {
      generatedAt: new Date().toISOString(),
      documentCount: docs.length,
    },
  }));
}

// ── Full Q&A Generation Pipeline ─────────────────────────────────

/**
 * Select document pairs for multi-hop and comparison questions.
 * Prefers cross-category pairs for more interesting questions.
 */
function selectDocumentPairs(
  docs: CorpusDocument[],
  maxPairs: number,
): CorpusDocument[][] {
  const pairs: CorpusDocument[][] = [];

  // Prefer cross-category pairs
  for (let i = 0; i < docs.length && pairs.length < maxPairs; i++) {
    for (let j = i + 1; j < docs.length && pairs.length < maxPairs; j++) {
      if (docs[i].category !== docs[j].category) {
        pairs.push([docs[i], docs[j]]);
      }
    }
  }

  // Fill remaining with same-category pairs
  for (let i = 0; i < docs.length && pairs.length < maxPairs; i++) {
    for (let j = i + 1; j < docs.length && pairs.length < maxPairs; j++) {
      if (!pairs.some(
        (p) =>
          (p[0].id === docs[i].id && p[1].id === docs[j].id) ||
          (p[0].id === docs[j].id && p[1].id === docs[i].id),
      )) {
        pairs.push([docs[i], docs[j]]);
      }
    }
  }

  return pairs;
}

/**
 * Generate a complete Q&A dataset from corpus documents.
 *
 * Generates single-hop, multi-hop, and comparison questions across
 * the corpus, returning a balanced dataset.
 *
 * @param docs - Corpus documents to generate questions from
 * @param llm - LLM provider for question generation
 * @param options - Generation options
 * @returns Array of generated Q&A items
 */
export async function generateQADataset(
  docs: CorpusDocument[],
  llm: LLMProvider,
  options?: QAGeneratorOptions,
): Promise<GeneratedQA[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const allQA: GeneratedQA[] = [];

  log.info({ docCount: docs.length, options: opts }, 'Starting Q&A dataset generation');

  // Generate single-hop questions (one per document)
  for (const doc of docs) {
    const singleHop = await generateSingleHopQuestions(doc, llm, opts.singleHopPerDoc, opts.model);
    allQA.push(...singleHop);
  }

  // Generate multi-hop and comparison questions from document pairs
  const maxPairs = Math.min(docs.length * (docs.length - 1) / 2, 10);
  const pairs = selectDocumentPairs(docs, maxPairs);

  for (const pair of pairs) {
    const multiHop = await generateMultiHopQuestions(pair, llm, opts.multiHopPerPair, opts.model);
    allQA.push(...multiHop);

    const comparison = await generateComparisonQuestions(pair, llm, opts.comparisonPerPair, opts.model);
    allQA.push(...comparison);
  }

  log.info({
    totalQA: allQA.length,
    singleHop: allQA.filter((q) => q.category === 'single-hop').length,
    multiHop: allQA.filter((q) => q.category === 'multi-hop').length,
    comparative: allQA.filter((q) => q.category === 'comparative').length,
  }, 'Q&A dataset generation complete');

  return allQA;
}
