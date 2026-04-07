/**
 * Evaluation metrics for benchmark scoring.
 *
 * Combines RAGAS-style metrics with LLM-as-Judge evaluation.
 * Integrates cost and latency tracking for comprehensive comparison.
 */

import type {
  Answer,
  Query,
  RagasScores,
  JudgeScores,
  LLMProvider,
  ChatMessage,
} from '../../types.ts';
import { createLogger } from '../../logger.ts';
import { computeAllRagasMetrics, type RagasMetricScores } from './ragas.ts';

const log = createLogger('metrics');

// ── LLM-as-Judge Rubric ─────────────────────────────────────────

/** Custom rubric for LLM-as-Judge evaluation. */
export interface JudgeRubric {
  /** Name of the rubric */
  name: string;
  /** Dimensions to evaluate */
  dimensions: string[];
  /** System prompt for the judge */
  systemPrompt: string;
}

/** Default judge rubric for answer quality evaluation. */
export const DEFAULT_JUDGE_RUBRIC: JudgeRubric = {
  name: 'answer-quality',
  dimensions: ['correctness', 'completeness', 'coherence', 'citationQuality'],
  systemPrompt: `You are an expert judge evaluating answer quality. You must evaluate the answer against the expected answer and the cited sources.

Score the answer on these dimensions (each 0-1):
- correctness: Does the answer contain factually correct information that matches the expected answer?
- completeness: Does the answer cover all aspects of the question and expected answer?
- coherence: Is the answer well-structured, clear, and easy to understand?
- citationQuality: Are the citations relevant, specific, and do they support the claims?

You MUST respond with valid JSON only:
{
  "correctness": <0-1>,
  "completeness": <0-1>,
  "coherence": <0-1>,
  "citationQuality": <0-1>,
  "reasoning": "<2-3 sentence explanation of your scores>"
}`,
};

// ── RAGAS Scoring (delegates to ragas.ts) ────────────────────────

/**
 * Compute RAGAS-style scores using dedicated per-metric LLM-as-Judge prompts.
 *
 * This is the main entry point for RAGAS evaluation. Each of the four metrics
 * is evaluated independently with specialized prompts.
 *
 * @param query - The original question
 * @param answer - The generated answer
 * @param llm - LLM provider for evaluation
 * @returns RAGAS scores (faithfulness, relevancy, precision, recall)
 */
export async function computeRagasScores(
  query: Query,
  answer: Answer,
  llm: LLMProvider,
): Promise<RagasScores> {
  const result = await computeAllRagasMetrics(query, answer, llm);
  return {
    faithfulness: result.scores.faithfulness,
    answerRelevancy: result.scores.answerRelevancy,
    contextRelevancy: result.scores.contextPrecision,
    contextPrecision: result.scores.contextRecall,
  };
}

// ── LLM-as-Judge ─────────────────────────────────────────────────

/**
 * Run LLM-as-Judge evaluation with a configurable rubric.
 *
 * @param query - The original question
 * @param answer - The generated answer
 * @param llm - LLM provider for evaluation
 * @param rubric - Custom rubric (defaults to answer-quality rubric)
 * @returns Judge scores (correctness, completeness, coherence, citation quality)
 */
export async function computeJudgeScores(
  query: Query,
  answer: Answer,
  llm: LLMProvider,
  rubric: JudgeRubric = DEFAULT_JUDGE_RUBRIC,
): Promise<JudgeScores> {
  const context = answer.citations.length > 0
    ? answer.citations.map((c, i) =>
        `[${i + 1}] ${c.source}${c.excerpt ? `: ${c.excerpt}` : ''}`
      ).join('\n')
    : 'No citations provided.';

  const messages: ChatMessage[] = [
    { role: 'system', content: rubric.systemPrompt },
    {
      role: 'user',
      content: `Judge this answer:

Question: ${query.text}
Expected Answer: ${query.expectedAnswer ?? 'N/A'}

Answer: ${answer.text}

Citations/Context:
${context}`,
    },
  ];

  try {
    const response = await llm.complete(messages, { responseFormat: 'json', temperature: 0 });
    const scores = JSON.parse(response.content);

    return {
      correctness: clamp(scores.correctness ?? 0),
      completeness: clamp(scores.completeness ?? 0),
      coherence: clamp(scores.coherence ?? 0),
      citationQuality: clamp(scores.citationQuality ?? 0),
      reasoning: scores.reasoning,
    };
  } catch (err) {
    log.error({ queryId: query.id, err }, 'Judge scoring failed');
    return {
      correctness: 0,
      completeness: 0,
      coherence: 0,
      citationQuality: 0,
      reasoning: 'Scoring failed due to an error',
    };
  }
}

/**
 * Determine the winner between wiki and RAG answers.
 *
 * Uses a configurable threshold (default 0.05) to avoid calling marginal
 * differences as wins — closer results are ties.
 */
export function determineWinner(
  wikiJudge: JudgeScores,
  ragJudge: JudgeScores,
  threshold: number = 0.05,
): 'wiki' | 'rag' | 'tie' {
  const wikiAvg =
    (wikiJudge.correctness + wikiJudge.completeness + wikiJudge.coherence + wikiJudge.citationQuality) / 4;
  const ragAvg =
    (ragJudge.correctness + ragJudge.completeness + ragJudge.coherence + ragJudge.citationQuality) / 4;

  if (wikiAvg - ragAvg > threshold) return 'wiki';
  if (ragAvg - wikiAvg > threshold) return 'rag';
  return 'tie';
}

/** Clamp a number to [0, 1]. */
function clamp(n: number): number {
  return Math.max(0, Math.min(1, isNaN(n) ? 0 : n));
}
