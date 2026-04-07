/**
 * RAGAS-style evaluation metrics — faithfulness, answer relevancy,
 * context precision, and context recall.
 *
 * Each metric is implemented as an LLM-as-Judge prompt that returns a 0-1 score
 * with an explanation of the reasoning behind the score.
 */

import type {
  Answer,
  Query,
  LLMProvider,
  ChatMessage,
} from '../../types.ts';
import { createLogger } from '../../logger.ts';

const log = createLogger('ragas-metrics');

// ── Types ────────────────────────────────────────────────────────

/** Full RAGAS scores with context recall (enhanced from the original). */
export interface RagasMetricScores {
  /** How faithful the answer is to the retrieved context (0-1) */
  faithfulness: number;
  /** How relevant the answer is to the question (0-1) */
  answerRelevancy: number;
  /** How precisely the retrieved context supports the answer (0-1) */
  contextPrecision: number;
  /** How much of the needed context was actually retrieved (0-1) */
  contextRecall: number;
}

/** Single metric evaluation result with explanation. */
export interface MetricResult {
  /** Metric name */
  metric: string;
  /** Score between 0 and 1 */
  score: number;
  /** LLM explanation for the score */
  explanation: string;
}

// ── Prompts ──────────────────────────────────────────────────────

const FAITHFULNESS_SYSTEM = `You are a faithfulness evaluator. Your task is to assess whether the answer is grounded in and supported by the given context.

Scoring rubric (0-1):
- 1.0: Every claim in the answer is directly supported by the context
- 0.7-0.9: Most claims are supported, minor inferences that are reasonable
- 0.4-0.6: Mix of supported and unsupported claims
- 0.1-0.3: Mostly unsupported claims or hallucinations
- 0.0: Answer is completely fabricated with no basis in context

You MUST respond with valid JSON only:
{"score": <number 0-1>, "explanation": "<brief reasoning>"}`;

const ANSWER_RELEVANCY_SYSTEM = `You are an answer relevancy evaluator. Your task is to assess how relevant and responsive the answer is to the question asked.

Scoring rubric (0-1):
- 1.0: Answer directly and completely addresses the question
- 0.7-0.9: Answer mostly addresses the question with minor gaps
- 0.4-0.6: Answer partially addresses the question or includes much irrelevant info
- 0.1-0.3: Answer barely addresses the question
- 0.0: Answer is completely irrelevant to the question

You MUST respond with valid JSON only:
{"score": <number 0-1>, "explanation": "<brief reasoning>"}`;

const CONTEXT_PRECISION_SYSTEM = `You are a context precision evaluator. Your task is to assess how relevant the retrieved context (citations/sources) is to the question. High precision means the retrieved context contains information needed to answer the question with minimal noise.

Scoring rubric (0-1):
- 1.0: All retrieved context is highly relevant to the question
- 0.7-0.9: Most retrieved context is relevant, minor noise
- 0.4-0.6: Mix of relevant and irrelevant context
- 0.1-0.3: Mostly irrelevant context retrieved
- 0.0: No relevant context at all

You MUST respond with valid JSON only:
{"score": <number 0-1>, "explanation": "<brief reasoning>"}`;

const CONTEXT_RECALL_SYSTEM = `You are a context recall evaluator. Your task is to assess how much of the information needed to answer the question correctly (as specified by the ground truth answer) was present in the retrieved context.

Scoring rubric (0-1):
- 1.0: All information needed for the ground truth answer is present in context
- 0.7-0.9: Most information is present, minor gaps
- 0.4-0.6: About half the needed information is present
- 0.1-0.3: Little of the needed information is present
- 0.0: None of the needed information is in context

You MUST respond with valid JSON only:
{"score": <number 0-1>, "explanation": "<brief reasoning>"}`;

// ── Metric Evaluation Functions ──────────────────────────────────

/** Clamp a number to [0, 1]. */
function clamp(n: number): number {
  return Math.max(0, Math.min(1, isNaN(n) ? 0 : n));
}

/** Parse a JSON score response from the LLM, with fallback. */
function parseScoreResponse(content: string, metric: string): MetricResult {
  try {
    const parsed = JSON.parse(content);
    return {
      metric,
      score: clamp(typeof parsed.score === 'number' ? parsed.score : 0),
      explanation: parsed.explanation ?? 'No explanation provided',
    };
  } catch {
    log.warn({ metric, content: content.slice(0, 200) }, 'Failed to parse score response');
    return { metric, score: 0, explanation: 'Failed to parse LLM response' };
  }
}

/** Format context from citations for evaluation. */
function formatContext(answer: Answer): string {
  if (answer.citations.length === 0) return 'No context/citations provided.';
  return answer.citations
    .map((c, i) => `[${i + 1}] Source: ${c.source}${c.excerpt ? `\nExcerpt: ${c.excerpt}` : ''}`)
    .join('\n\n');
}

/**
 * Evaluate faithfulness — is the answer grounded in the retrieved context?
 */
export async function evaluateFaithfulness(
  query: Query,
  answer: Answer,
  llm: LLMProvider,
): Promise<MetricResult> {
  const context = formatContext(answer);
  const messages: ChatMessage[] = [
    { role: 'system', content: FAITHFULNESS_SYSTEM },
    {
      role: 'user',
      content: `Question: ${query.text}\n\nRetrieved Context:\n${context}\n\nAnswer: ${answer.text}`,
    },
  ];

  const response = await llm.complete(messages, { responseFormat: 'json', temperature: 0 });
  return parseScoreResponse(response.content, 'faithfulness');
}

/**
 * Evaluate answer relevancy — does the answer address the question?
 */
export async function evaluateAnswerRelevancy(
  query: Query,
  answer: Answer,
  llm: LLMProvider,
): Promise<MetricResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: ANSWER_RELEVANCY_SYSTEM },
    {
      role: 'user',
      content: `Question: ${query.text}\n\nAnswer: ${answer.text}`,
    },
  ];

  const response = await llm.complete(messages, { responseFormat: 'json', temperature: 0 });
  return parseScoreResponse(response.content, 'answerRelevancy');
}

/**
 * Evaluate context precision — is the retrieved context relevant?
 */
export async function evaluateContextPrecision(
  query: Query,
  answer: Answer,
  llm: LLMProvider,
): Promise<MetricResult> {
  const context = formatContext(answer);
  const messages: ChatMessage[] = [
    { role: 'system', content: CONTEXT_PRECISION_SYSTEM },
    {
      role: 'user',
      content: `Question: ${query.text}\n\nRetrieved Context:\n${context}`,
    },
  ];

  const response = await llm.complete(messages, { responseFormat: 'json', temperature: 0 });
  return parseScoreResponse(response.content, 'contextPrecision');
}

/**
 * Evaluate context recall — was the needed context retrieved?
 */
export async function evaluateContextRecall(
  query: Query,
  answer: Answer,
  llm: LLMProvider,
): Promise<MetricResult> {
  const context = formatContext(answer);
  const messages: ChatMessage[] = [
    { role: 'system', content: CONTEXT_RECALL_SYSTEM },
    {
      role: 'user',
      content: `Question: ${query.text}\n\nGround Truth Answer: ${query.expectedAnswer ?? 'N/A'}\n\nRetrieved Context:\n${context}`,
    },
  ];

  const response = await llm.complete(messages, { responseFormat: 'json', temperature: 0 });
  return parseScoreResponse(response.content, 'contextRecall');
}

/**
 * Compute all four RAGAS metric scores for an answer.
 *
 * @param query - The original question (with optional expectedAnswer for recall)
 * @param answer - The generated answer with citations
 * @param llm - LLM provider for evaluation
 * @returns All RAGAS metric scores (0-1 each)
 */
export async function computeAllRagasMetrics(
  query: Query,
  answer: Answer,
  llm: LLMProvider,
): Promise<{ scores: RagasMetricScores; details: MetricResult[] }> {
  log.info({ queryId: query.id, system: answer.system }, 'Computing RAGAS metrics');

  const [faithfulness, answerRelevancy, contextPrecision, contextRecall] = await Promise.all([
    evaluateFaithfulness(query, answer, llm),
    evaluateAnswerRelevancy(query, answer, llm),
    evaluateContextPrecision(query, answer, llm),
    evaluateContextRecall(query, answer, llm),
  ]);

  const scores: RagasMetricScores = {
    faithfulness: faithfulness.score,
    answerRelevancy: answerRelevancy.score,
    contextPrecision: contextPrecision.score,
    contextRecall: contextRecall.score,
  };

  log.info({ queryId: query.id, system: answer.system, scores }, 'RAGAS metrics computed');

  return {
    scores,
    details: [faithfulness, answerRelevancy, contextPrecision, contextRecall],
  };
}
