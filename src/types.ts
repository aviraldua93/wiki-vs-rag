/**
 * Shared types for wiki-vs-rag benchmark system.
 *
 * All core domain types used across wiki-agent, benchmark harness,
 * corpus loader, and providers.
 */

// ── Wiki Page Types ──────────────────────────────────────────────

/** Allowed wiki page types matching the YAML frontmatter schema. */
export type WikiPageType = 'source' | 'entity' | 'concept' | 'synthesis';

/** A compiled wiki page with YAML frontmatter fields + content. */
export interface WikiPage {
  /** Page title (appears in frontmatter and as heading) */
  title: string;
  /** Classification of the page */
  type: WikiPageType;
  /** Freeform tags for categorization */
  tags: string[];
  /** Source document paths or identifiers this page was derived from */
  sources: string[];
  /** Markdown body content (excluding frontmatter) */
  content: string;
  /** Extracted [[wikilink]] targets found in content */
  wikilinks: string[];
  /** ISO date string when created */
  created: string;
  /** ISO date string when last updated */
  updated: string;
  /** File path relative to wiki root (e.g., "sources/api-design.md") */
  filePath?: string;
}

// ── Query / Answer Types ─────────────────────────────────────────

/** A question to be answered by either the wiki-agent or RAG system. */
export interface Query {
  /** Unique identifier for the query */
  id: string;
  /** The natural-language question */
  text: string;
  /** Expected answer for evaluation (ground truth) */
  expectedAnswer?: string;
  /** Category of the question for analysis */
  category?: QueryCategory;
  /** Metadata about question complexity */
  metadata?: Record<string, unknown>;
}

/** Question categories matching corpus design. */
export type QueryCategory =
  | 'single-hop'
  | 'multi-hop'
  | 'temporal'
  | 'comparative'
  | 'aggregation';

/** A citation pointing to a source used in the answer. */
export interface Citation {
  /** Source identifier (file path, page title, or wikilink) */
  source: string;
  /** Relevant excerpt from the source */
  excerpt?: string;
  /** Relevance score (0-1) if available */
  relevance?: number;
}

/** An answer produced by either the wiki-agent or RAG system. */
export interface Answer {
  /** The query this answer responds to */
  queryId: string;
  /** The generated answer text */
  text: string;
  /** Citations supporting the answer */
  citations: Citation[];
  /** Which system produced this answer */
  system: 'wiki' | 'rag';
  /** Time taken to produce the answer in milliseconds */
  latencyMs: number;
  /** Estimated cost in USD for producing this answer */
  costUsd?: number;
  /** Token usage breakdown */
  tokenUsage?: TokenUsage;
}

/** Token usage tracking for cost analysis. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// ── Benchmark Types ──────────────────────────────────────────────

/** Scores from the RAGAS evaluation framework. */
export interface RagasScores {
  /** How faithful the answer is to the retrieved context (0-1) */
  faithfulness: number;
  /** How relevant the answer is to the question (0-1) */
  answerRelevancy: number;
  /** How relevant the retrieved context is (0-1) */
  contextRelevancy: number;
  /** How precisely the context supports the answer (0-1) */
  contextPrecision: number;
}

/** Scores from LLM-as-Judge evaluation. */
export interface JudgeScores {
  /** Correctness of the answer (0-1) */
  correctness: number;
  /** Completeness of the answer (0-1) */
  completeness: number;
  /** Coherence and readability (0-1) */
  coherence: number;
  /** Quality of citations (0-1) */
  citationQuality: number;
  /** Free-form judge reasoning */
  reasoning?: string;
}

/** Result of a single benchmark comparison (one query, both systems). */
export interface BenchmarkResult {
  /** The query that was evaluated */
  query: Query;
  /** Answer from the wiki-agent system */
  wikiAnswer: Answer;
  /** Answer from the RAG system */
  ragAnswer: Answer;
  /** RAGAS scores for wiki answer */
  wikiRagasScores?: RagasScores;
  /** RAGAS scores for RAG answer */
  ragRagasScores?: RagasScores;
  /** LLM-as-Judge scores for wiki answer */
  wikiJudgeScores?: JudgeScores;
  /** LLM-as-Judge scores for RAG answer */
  ragJudgeScores?: JudgeScores;
  /** Winner determination */
  winner?: 'wiki' | 'rag' | 'tie';
  /** Timestamp of the evaluation */
  timestamp: string;
}

/** Aggregate results of a full benchmark run. */
export interface BenchmarkRun {
  /** Unique run identifier */
  id: string;
  /** When the run started */
  startedAt: string;
  /** When the run completed */
  completedAt?: string;
  /** Individual results per query */
  results: BenchmarkResult[];
  /** Aggregate stats */
  summary?: BenchmarkSummary;
}

/** Summary statistics for a benchmark run. */
export interface BenchmarkSummary {
  totalQueries: number;
  wikiWins: number;
  ragWins: number;
  ties: number;
  avgWikiLatencyMs: number;
  avgRagLatencyMs: number;
  totalWikiCostUsd: number;
  totalRagCostUsd: number;
  /** Breakdown by query category */
  byCategory: Record<string, {
    wikiWins: number;
    ragWins: number;
    ties: number;
  }>;
}

// ── Corpus Types ─────────────────────────────────────────────────

/** Categories of documents in the test corpus. */
export type CorpusCategory = 'technical' | 'narrative' | 'multi-doc' | 'evolving';

/** A raw document loaded from the corpus directory. */
export interface CorpusDocument {
  /** Unique identifier derived from file path */
  id: string;
  /** Document title (from frontmatter or filename) */
  title: string;
  /** Raw text content of the document */
  content: string;
  /** Full file path on disk */
  filePath: string;
  /** Path relative to the corpus root */
  relativePath: string;
  /** Which corpus category this belongs to */
  category: CorpusCategory;
  /** Parsed frontmatter metadata, if any */
  metadata: Record<string, unknown>;
  /** File size in bytes */
  sizeBytes: number;
}

// ── Provider Interfaces ──────────────────────────────────────────

/** Message format for LLM chat completions. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Response from an LLM completion call. */
export interface LLMResponse {
  content: string;
  tokenUsage: TokenUsage;
  model: string;
  finishReason: string;
}

/** Interface for LLM providers (OpenAI or Mock). */
export interface LLMProvider {
  /** Generate a chat completion */
  complete(messages: ChatMessage[], options?: LLMCompletionOptions): Promise<LLMResponse>;
  /** Get the provider name */
  readonly name: string;
}

/** Options for LLM completion requests. */
export interface LLMCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
}

/** A2A task sent to the RAG system. */
export interface A2ATask {
  id: string;
  message: string;
  metadata?: Record<string, unknown>;
}

/** A2A task result from the RAG system. */
export interface A2ATaskResult {
  taskId: string;
  status: 'completed' | 'failed' | 'cancelled';
  answer: string;
  citations: Citation[];
  latencyMs: number;
  tokenUsage?: TokenUsage;
}

/** Interface for RAG A2A client (real or mock). */
export interface RAGClient {
  /** Send a query to the RAG system and get a response */
  query(task: A2ATask): Promise<A2ATaskResult>;
  /** Check if the RAG service is available */
  healthCheck(): Promise<boolean>;
  /** Get the client name */
  readonly name: string;
}

// ── Config Types ─────────────────────────────────────────────────

/** Provider selection for dependency injection. */
export type ProviderType = 'openai' | 'mock';

/** Application configuration loaded from environment. */
export interface AppConfig {
  /** OpenAI API key (empty string in mock mode) */
  openaiApiKey: string;
  /** URL of the RAG A2A service */
  ragA2aUrl: string;
  /** Directory for compiled wiki output */
  wikiDir: string;
  /** Directory containing raw corpus documents */
  corpusDir: string;
  /** Logging level */
  logLevel: string;
  /** Which LLM provider to use */
  llmProvider: ProviderType;
  /** Which RAG client to use */
  ragProvider: ProviderType;
  /** Model to use for compilation */
  compileModel: string;
  /** Model to use for judge evaluation */
  judgeModel: string;
}
