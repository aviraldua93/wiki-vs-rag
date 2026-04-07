/**
 * LLM-as-Judge evaluator — accepts a rubric + answer + context + ground-truth,
 * returns 0-1 scores per dimension with explanations.
 */

import type {
  Answer,
  Query,
  LLMProvider,
  ChatMessage,
  JudgeScores,
} from '../../types.ts';
import { createLogger } from '../../logger.ts';

const log = createLogger('judge-evaluator');

// ── Types ────────────────────────────────────────────────────────

/** A rubric dimension for judge evaluation. */
export interface JudgeRubricDimension {
  /** Dimension name (e.g., 'correctness') */
  name: string;
  /** Description of what this dimension measures */
  description: string;
  /** Score anchors: what does 0, 0.5, and 1 mean? */
  anchors: {
    low: string;   // ~0.0
    mid: string;   // ~0.5
    high: string;  // ~1.0
  };
}

/** Full rubric for judge evaluation. */
export interface JudgeRubric {
  /** Name of this rubric */
  name: string;
  /** Dimensions to evaluate */
  dimensions: JudgeRubricDimension[];
}

/** Result from a judge evaluation. */
export interface JudgeEvalResult {
  /** Scores per dimension (0-1) */
  scores: JudgeScores;
  /** Per-dimension detailed reasoning */
  dimensionDetails: Array<{
    dimension: string;
    score: number;
    reasoning: string;
  }>;
  /** Overall reasoning */
  overallReasoning: string;
}

// ── Default Rubric ───────────────────────────────────────────────

/** The default rubric matching the JudgeScores interface. */
export const DEFAULT_JUDGE_RUBRIC: JudgeRubric = {
  name: 'default-benchmark-rubric',
  dimensions: [
    {
      name: 'correctness',
      description: 'Factual accuracy of the answer compared to the ground truth',
      anchors: {
        low: 'Answer contains major factual errors or contradicts the ground truth',
        mid: 'Answer is partially correct with some inaccuracies',
        high: 'Answer is fully correct and consistent with the ground truth',
      },
    },
    {
      name: 'completeness',
      description: 'How completely the answer addresses all aspects of the question',
      anchors: {
        low: 'Answer misses most key points from the expected answer',
        mid: 'Answer covers some key points but misses important details',
        high: 'Answer thoroughly covers all key points from the expected answer',
      },
    },
    {
      name: 'coherence',
      description: 'Logical structure, readability, and clarity of the answer',
      anchors: {
        low: 'Answer is disorganized, hard to follow, or self-contradictory',
        mid: 'Answer is somewhat organized but could be clearer',
        high: 'Answer is well-organized, clear, and easy to follow',
      },
    },
    {
      name: 'citationQuality',
      description: 'Quality and relevance of source citations supporting the answer',
      anchors: {
        low: 'No citations or citations are irrelevant to the claims',
        mid: 'Some citations support the answer but coverage is incomplete',
        high: 'All major claims are supported by relevant, specific citations',
      },
    },
  ],
};

// ── Prompt Building ──────────────────────────────────────────────

/** Build the judge system prompt from a rubric. */
function buildJudgeSystemPrompt(rubric: JudgeRubric): string {
  const dimensionDescriptions = rubric.dimensions
    .map((d) => {
      return `**${d.name}** (0-1): ${d.description}
  - 0.0-0.3: ${d.anchors.low}
  - 0.4-0.6: ${d.anchors.mid}
  - 0.7-1.0: ${d.anchors.high}`;
    })
    .join('\n\n');

  return `You are an expert evaluation judge. Score the provided answer on the following dimensions, each on a scale of 0 to 1.

${dimensionDescriptions}

You MUST respond with valid JSON in this exact format:
{
  "correctness": <number 0-1>,
  "completeness": <number 0-1>,
  "coherence": <number 0-1>,
  "citationQuality": <number 0-1>,
  "reasoning": "<overall assessment explaining your scores>"
}`;
}

/** Build the judge user prompt with answer, context, and ground truth. */
function buildJudgeUserPrompt(query: Query, answer: Answer): string {
  const citationsText = answer.citations.length > 0
    ? answer.citations
        .map((c, i) => `[${i + 1}] ${c.source}${c.excerpt ? `: ${c.excerpt}` : ''}`)
        .join('\n')
    : 'No citations provided.';

  return `Evaluate this answer:

**Question:** ${query.text}

**Ground Truth Answer:** ${query.expectedAnswer ?? 'Not provided'}

**System Answer (from ${answer.system}):**
${answer.text}

**Citations:**
${citationsText}

Score each dimension 0-1 and provide your reasoning.`;
}

// ── Core Evaluator ───────────────────────────────────────────────

/** Clamp a number to [0, 1]. */
function clamp(n: number): number {
  return Math.max(0, Math.min(1, isNaN(n) ? 0 : n));
}

/**
 * Run LLM-as-Judge evaluation with a configurable rubric.
 *
 * @param query - Original question with expected answer
 * @param answer - Generated answer with citations
 * @param llm - LLM provider for judge evaluation
 * @param rubric - Evaluation rubric (defaults to standard rubric)
 * @returns Judge evaluation result with scores and reasoning
 */
export async function evaluateWithJudge(
  query: Query,
  answer: Answer,
  llm: LLMProvider,
  rubric: JudgeRubric = DEFAULT_JUDGE_RUBRIC,
): Promise<JudgeEvalResult> {
  log.info({ queryId: query.id, system: answer.system, rubric: rubric.name }, 'Running judge evaluation');

  const messages: ChatMessage[] = [
    { role: 'system', content: buildJudgeSystemPrompt(rubric) },
    { role: 'user', content: buildJudgeUserPrompt(query, answer) },
  ];

  try {
    const response = await llm.complete(messages, { responseFormat: 'json', temperature: 0 });
    const parsed = JSON.parse(response.content);

    const scores: JudgeScores = {
      correctness: clamp(parsed.correctness ?? 0),
      completeness: clamp(parsed.completeness ?? 0),
      coherence: clamp(parsed.coherence ?? 0),
      citationQuality: clamp(parsed.citationQuality ?? 0),
      reasoning: parsed.reasoning ?? 'No reasoning provided',
    };

    const dimensionDetails = rubric.dimensions.map((d) => ({
      dimension: d.name,
      score: scores[d.name as keyof JudgeScores] as number,
      reasoning: parsed.reasoning ?? '',
    }));

    return {
      scores,
      dimensionDetails,
      overallReasoning: parsed.reasoning ?? 'No reasoning provided',
    };
  } catch (err) {
    log.error({ queryId: query.id, err }, 'Judge evaluation failed');
    return {
      scores: {
        correctness: 0,
        completeness: 0,
        coherence: 0,
        citationQuality: 0,
        reasoning: 'Judge evaluation failed due to an error',
      },
      dimensionDetails: rubric.dimensions.map((d) => ({
        dimension: d.name,
        score: 0,
        reasoning: 'Evaluation failed',
      })),
      overallReasoning: 'Judge evaluation failed due to an error',
    };
  }
}
