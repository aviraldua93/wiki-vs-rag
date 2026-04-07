/**
 * Synthetic Q&A generator — uses LLM to generate benchmark questions from corpus.
 *
 * Generates three types of questions:
 * - Single-hop factoid: Direct fact retrieval from one document
 * - Multi-hop reasoning: Requires combining info from 2+ documents
 * - Comparison: Requires comparing information across documents
 *
 * Each generated Q&A includes question, ground-truth answer, source documents,
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

/** Reasoning type for generated questions. */
export type ReasoningType = 'factoid' | 'multi-hop' | 'comparison' | 'temporal' | 'aggregation';

/** Difficulty level for generated questions. */
export type DifficultyLevel = 'easy' | 'medium' | 'hard';

/** A generated Q&A item with full metadata. */
export interface GeneratedQA {
  /** Unique identifier */
  id: string;
  /** The question text */
  question: string;
  /** Ground-truth answer */
  groundTruthAnswer: string;
  /** Source document IDs used to generate this Q&A */
  sourceDocIds: string[];
  /** Source document titles */
  sourceDocTitles: string[];
  /** Reasoning type tag */
  reasoningType: ReasoningType;
  /** Query category for benchmark classification */
  category: QueryCategory;
  /** Difficulty level */
  difficulty: DifficultyLevel;
  /** When this Q&A was generated */
  generatedAt: string;
}

/** A complete Q&A dataset. */
export interface QADataset {
  /** Dataset name */
  name: string;
  /** Dataset description */
  description: string;
  /** When the dataset was generated */
  generatedAt: string;
  /** Number of Q&A items */
  count: number;
  /** The Q&A items */
  items: GeneratedQA[];
  /** Metadata about generation */
  metadata: {
    corpusDocCount: number;
    corpusCategories: string[];
    generatorModel: string;
  };
}

/** Options for Q&A generation. */
export interface QAGeneratorOptions {
  /** Number of single-hop factoid questions per document */
  singleHopPerDoc?: number;
  /** Number of multi-hop questions to generate */
  multiHopCount?: number;
  /** Number of comparison questions to generate */
  comparisonCount?: number;
  /** Model to use for generation */
  model?: string;
}

const DEFAULT_OPTIONS: Required<QAGeneratorOptions> = {
  singleHopPerDoc: 2,
  multiHopCount: 3,
  comparisonCount: 2,
  model: 'gpt-4o-mini',
};

// ── Generation Prompts ───────────────────────────────────────────

const SINGLE_HOP_SYSTEM = `You are a benchmark question generator. Generate factoid questions that can be answered from a single document.

For each question, provide:
- A specific, unambiguous question about a fact in the document
- The correct answer based only on the document content
- A difficulty rating (easy, medium, hard)

You MUST respond with valid JSON only:
{
  "questions": [
    {
      "question": "<specific factoid question>",
      "answer": "<correct answer from the document>",
      "difficulty": "easy|medium|hard"
    }
  ]
}`;

const MULTI_HOP_SYSTEM = `You are a benchmark question generator. Generate multi-hop reasoning questions that require combining information from multiple documents to answer correctly.

For each question:
- The answer MUST require information from at least 2 of the provided documents
- The question should test reasoning, not just fact recall
- Provide the correct answer that synthesizes information across documents

You MUST respond with valid JSON only:
{
  "questions": [
    {
      "question": "<question requiring multi-document reasoning>",
      "answer": "<answer synthesizing information from multiple documents>",
      "difficulty": "medium|hard"
    }
  ]
}`;

const COMPARISON_SYSTEM = `You are a benchmark question generator. Generate comparison questions that require comparing or contrasting information across documents.

For each question:
- The question should explicitly ask for a comparison, contrast, or evaluation
- The answer should reference specific comparable data points from both documents
- Focus on quantitative or qualitative differences that are clearly stated

You MUST respond with valid JSON only:
{
  "questions": [
    {
      "question": "<comparison question across documents>",
      "answer": "<answer with specific comparisons>",
      "difficulty": "medium|hard"
    }
  ]
}`;

// ── Generator Functions ──────────────────────────────────────────

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
      content: `Generate ${count} factoid questions from this document.

Document Title: ${doc.title}
Document Content:
${doc.content.slice(0, 4000)}`,
    },
  ];

  try {
    const response = await llm.complete(messages, { model, responseFormat: 'json' });
    const parsed = JSON.parse(response.content);
    const questions = Array.isArray(parsed.questions) ? parsed.questions : [];

    return questions.slice(0, count).map((q: any) => ({
      id: uuid(),
      question: q.question ?? 'Generated question',
      groundTruthAnswer: q.answer ?? 'Generated answer',
      sourceDocIds: [doc.id],
      sourceDocTitles: [doc.title],
      reasoningType: 'factoid' as ReasoningType,
      category: 'single-hop' as QueryCategory,
      difficulty: validateDifficulty(q.difficulty),
      generatedAt: new Date().toISOString(),
    }));
  } catch (err) {
    log.error({ docId: doc.id, err }, 'Single-hop generation failed');
    return [];
  }
}

/**
 * Generate multi-hop reasoning questions from multiple documents.
 */
export async function generateMultiHopQuestions(
  docs: CorpusDocument[],
  llm: LLMProvider,
  count: number = 3,
  model?: string,
): Promise<GeneratedQA[]> {
  if (docs.length < 2) {
    log.warn('Need at least 2 documents for multi-hop questions');
    return [];
  }

  log.info({ docCount: docs.length, count }, 'Generating multi-hop questions');

  const docSummaries = docs
    .slice(0, 5) // Limit to 5 docs for prompt size
    .map((d, i) => `--- Document ${i + 1}: ${d.title} (${d.id}) ---\n${d.content.slice(0, 2000)}`)
    .join('\n\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: MULTI_HOP_SYSTEM },
    {
      role: 'user',
      content: `Generate ${count} multi-hop reasoning questions from these documents.

${docSummaries}`,
    },
  ];

  try {
    const response = await llm.complete(messages, { model, responseFormat: 'json' });
    const parsed = JSON.parse(response.content);
    const questions = Array.isArray(parsed.questions) ? parsed.questions : [];

    return questions.slice(0, count).map((q: any) => ({
      id: uuid(),
      question: q.question ?? 'Generated multi-hop question',
      groundTruthAnswer: q.answer ?? 'Generated multi-hop answer',
      sourceDocIds: docs.map((d) => d.id),
      sourceDocTitles: docs.map((d) => d.title),
      reasoningType: 'multi-hop' as ReasoningType,
      category: 'multi-hop' as QueryCategory,
      difficulty: validateDifficulty(q.difficulty ?? 'medium'),
      generatedAt: new Date().toISOString(),
    }));
  } catch (err) {
    log.error({ err }, 'Multi-hop generation failed');
    return [];
  }
}

/**
 * Generate comparison questions from document pairs.
 */
export async function generateComparisonQuestions(
  docs: CorpusDocument[],
  llm: LLMProvider,
  count: number = 2,
  model?: string,
): Promise<GeneratedQA[]> {
  if (docs.length < 2) {
    log.warn('Need at least 2 documents for comparison questions');
    return [];
  }

  log.info({ docCount: docs.length, count }, 'Generating comparison questions');

  const docSummaries = docs
    .slice(0, 4)
    .map((d, i) => `--- Document ${i + 1}: ${d.title} (${d.id}) ---\n${d.content.slice(0, 2000)}`)
    .join('\n\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: COMPARISON_SYSTEM },
    {
      role: 'user',
      content: `Generate ${count} comparison questions from these documents.

${docSummaries}`,
    },
  ];

  try {
    const response = await llm.complete(messages, { model, responseFormat: 'json' });
    const parsed = JSON.parse(response.content);
    const questions = Array.isArray(parsed.questions) ? parsed.questions : [];

    return questions.slice(0, count).map((q: any) => ({
      id: uuid(),
      question: q.question ?? 'Generated comparison question',
      groundTruthAnswer: q.answer ?? 'Generated comparison answer',
      sourceDocIds: docs.map((d) => d.id),
      sourceDocTitles: docs.map((d) => d.title),
      reasoningType: 'comparison' as ReasoningType,
      category: 'comparative' as QueryCategory,
      difficulty: validateDifficulty(q.difficulty ?? 'medium'),
      generatedAt: new Date().toISOString(),
    }));
  } catch (err) {
    log.error({ err }, 'Comparison generation failed');
    return [];
  }
}

// ── Full Generator ───────────────────────────────────────────────

/**
 * Generate a complete Q&A dataset from corpus documents.
 *
 * Produces single-hop factoid questions (from each document),
 * multi-hop reasoning questions (across documents), and
 * comparison questions (between document pairs).
 *
 * @param docs - Corpus documents to generate Q&A from
 * @param llm - LLM provider for generation
 * @param options - Generation options
 * @returns Complete Q&A dataset
 */
export async function generateQADataset(
  docs: CorpusDocument[],
  llm: LLMProvider,
  options?: QAGeneratorOptions,
): Promise<QADataset> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const allQAs: GeneratedQA[] = [];

  log.info(
    { docCount: docs.length, singleHopPerDoc: opts.singleHopPerDoc, multiHopCount: opts.multiHopCount, comparisonCount: opts.comparisonCount },
    'Starting Q&A dataset generation',
  );

  // Generate single-hop questions per document
  for (const doc of docs) {
    const singleHop = await generateSingleHopQuestions(doc, llm, opts.singleHopPerDoc, opts.model);
    allQAs.push(...singleHop);
  }

  // Generate multi-hop questions across documents
  if (docs.length >= 2) {
    const multiHop = await generateMultiHopQuestions(docs, llm, opts.multiHopCount, opts.model);
    allQAs.push(...multiHop);
  }

  // Generate comparison questions
  if (docs.length >= 2) {
    const comparison = await generateComparisonQuestions(docs, llm, opts.comparisonCount, opts.model);
    allQAs.push(...comparison);
  }

  const dataset: QADataset = {
    name: `qa-dataset-${Date.now()}`,
    description: `Auto-generated Q&A dataset from ${docs.length} corpus documents`,
    generatedAt: new Date().toISOString(),
    count: allQAs.length,
    items: allQAs,
    metadata: {
      corpusDocCount: docs.length,
      corpusCategories: [...new Set(docs.map((d) => d.category))],
      generatorModel: opts.model,
    },
  };

  log.info(
    { count: dataset.count, singleHop: allQAs.filter((q) => q.reasoningType === 'factoid').length, multiHop: allQAs.filter((q) => q.reasoningType === 'multi-hop').length, comparison: allQAs.filter((q) => q.reasoningType === 'comparison').length },
    'Q&A dataset generated',
  );

  return dataset;
}

// ── Helpers ──────────────────────────────────────────────────────

function validateDifficulty(value: string): DifficultyLevel {
  if (value === 'easy' || value === 'medium' || value === 'hard') return value;
  return 'medium';
}
