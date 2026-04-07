/**
 * RAG A2A Client — interface, real HTTP client, and MockRAGClient.
 *
 * Factory function selects provider based on config.
 */

import type {
  RAGClient,
  A2ATask,
  A2ATaskResult,
  Citation,
  ProviderType,
} from '../types.ts';
import { createLogger } from '../logger.ts';

const log = createLogger('rag-client');

// ── Mock RAG Client ──────────────────────────────────────────────

/** Configuration for MockRAGClient behavior. */
export interface MockRAGClientOptions {
  /** Default answer content to return */
  defaultAnswer?: string;
  /** Simulated latency in milliseconds (0 = instant) */
  latencyMs?: number;
  /** Custom response map: task message pattern → answer */
  responseMap?: Record<string, string>;
  /** Whether healthCheck should return true */
  healthy?: boolean;
  /** Whether queries should fail */
  shouldFail?: boolean;
}

const DEFAULT_MOCK_OPTIONS: Required<MockRAGClientOptions> = {
  defaultAnswer: 'This is a mock RAG response for testing purposes.',
  latencyMs: 0,
  responseMap: {},
  healthy: true,
  shouldFail: false,
};

/**
 * MockRAGClient — deterministic A2A client for testing.
 *
 * Returns configurable stub responses. Supports:
 * - Custom answer content per query pattern
 * - Simulated latency
 * - Health check simulation
 * - Failure simulation
 */
export class MockRAGClient implements RAGClient {
  readonly name = 'mock-rag';
  private options: Required<MockRAGClientOptions>;
  private callCount = 0;
  private callLog: Array<{ task: A2ATask; result: A2ATaskResult }> = [];

  constructor(options?: MockRAGClientOptions) {
    this.options = { ...DEFAULT_MOCK_OPTIONS, ...options };
  }

  async query(task: A2ATask): Promise<A2ATaskResult> {
    this.callCount++;
    const startTime = Date.now();

    // Simulate latency
    if (this.options.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.latencyMs));
    }

    // Simulate failures
    if (this.options.shouldFail) {
      const result: A2ATaskResult = {
        taskId: task.id,
        status: 'failed',
        answer: '',
        citations: [],
        latencyMs: Date.now() - startTime,
      };
      this.callLog.push({ task, result });
      return result;
    }

    // Find matching response or use default
    let answer = this.options.defaultAnswer;
    for (const [pattern, response] of Object.entries(this.options.responseMap)) {
      if (task.message.toLowerCase().includes(pattern.toLowerCase())) {
        answer = response;
        break;
      }
    }

    const citations: Citation[] = [
      {
        source: 'mock-rag-source-1.md',
        excerpt: `Relevant excerpt for: ${task.message.slice(0, 50)}`,
        relevance: 0.88,
      },
      {
        source: 'mock-rag-source-2.md',
        excerpt: 'Supporting context from the knowledge base.',
        relevance: 0.72,
      },
    ];

    const result: A2ATaskResult = {
      taskId: task.id,
      status: 'completed',
      answer,
      citations,
      latencyMs: Date.now() - startTime,
      tokenUsage: {
        promptTokens: Math.ceil(task.message.length / 4),
        completionTokens: Math.ceil(answer.length / 4),
        totalTokens: Math.ceil((task.message.length + answer.length) / 4),
      },
    };

    this.callLog.push({ task, result });
    log.debug({ taskId: task.id, callCount: this.callCount }, 'MockRAGClient query');

    return result;
  }

  async healthCheck(): Promise<boolean> {
    return this.options.healthy;
  }

  /** Get the number of calls made to this mock. */
  getCallCount(): number {
    return this.callCount;
  }

  /** Get the full call log for assertions. */
  getCallLog(): Array<{ task: A2ATask; result: A2ATaskResult }> {
    return [...this.callLog];
  }

  /** Reset call tracking state. */
  reset(): void {
    this.callCount = 0;
    this.callLog = [];
  }

  /** Update mock options at runtime. */
  configure(options: Partial<MockRAGClientOptions>): void {
    this.options = { ...this.options, ...options };
  }
}

// ── Error Types ──────────────────────────────────────────────────

/** Structured error types for A2A client failures. */
export type A2AClientErrorKind =
  | 'connection_error'
  | 'timeout'
  | 'http_error'
  | 'invalid_response'
  | 'json_rpc_error'
  | 'unknown';

/** Structured error from the A2A client. */
export class A2AClientError extends Error {
  readonly kind: A2AClientErrorKind;
  readonly statusCode?: number;
  readonly taskId?: string;

  constructor(kind: A2AClientErrorKind, message: string, taskId?: string, statusCode?: number) {
    super(message);
    this.name = 'A2AClientError';
    this.kind = kind;
    this.taskId = taskId;
    this.statusCode = statusCode;
  }
}

// ── Real A2A RAG Client ──────────────────────────────────────────

/** Options for the A2A RAG client. */
export interface A2ARAGClientOptions {
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Maximum number of retries on transient errors (default: 0) */
  maxRetries?: number;
}

const DEFAULT_CLIENT_OPTIONS: Required<A2ARAGClientOptions> = {
  timeoutMs: 30000,
  maxRetries: 0,
};

/**
 * HTTP-based A2A RAG Client.
 *
 * Sends JSON-RPC 2.0 requests to the rag-a2a service.
 * Handles connection errors, timeouts, and malformed responses gracefully.
 */
export class A2ARAGClient implements RAGClient {
  readonly name = 'a2a-rag';
  private baseUrl: string;
  private options: Required<A2ARAGClientOptions>;

  constructor(baseUrl: string, options?: A2ARAGClientOptions) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.options = { ...DEFAULT_CLIENT_OPTIONS, ...options };
  }

  async query(task: A2ATask): Promise<A2ATaskResult> {
    const startTime = Date.now();

    log.info({ taskId: task.id, url: this.baseUrl }, 'Sending A2A query');

    let response: Response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.options.timeoutMs);

      try {
        response = await fetch(`${this.baseUrl}/a2a`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: task.id,
            method: 'message/send',
            params: {
              message: {
                kind: 'message',
                messageId: task.id,
                role: 'user',
                parts: [{ kind: 'text', text: task.message }],
                metadata: task.metadata,
              },
            },
          }),
        });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;

      // Distinguish timeout from connection errors
      if (err.name === 'AbortError' || err.message?.includes('abort')) {
        log.error({ taskId: task.id, timeoutMs: this.options.timeoutMs }, 'A2A request timed out');
        return {
          taskId: task.id,
          status: 'failed',
          answer: `A2A request timed out after ${this.options.timeoutMs}ms`,
          citations: [],
          latencyMs,
        };
      }

      log.error({ taskId: task.id, err }, 'A2A connection error');
      return {
        taskId: task.id,
        status: 'failed',
        answer: `A2A connection error: ${err.message ?? String(err)}`,
        citations: [],
        latencyMs,
      };
    }

    // Handle HTTP errors
    if (!response.ok) {
      log.error({ taskId: task.id, status: response.status }, 'A2A HTTP error');
      return {
        taskId: task.id,
        status: 'failed',
        answer: `A2A request failed: ${response.status} ${response.statusText}`,
        citations: [],
        latencyMs: Date.now() - startTime,
      };
    }

    // Parse response body
    let data: any;
    try {
      data = await response.json();
    } catch {
      log.error({ taskId: task.id }, 'A2A response is not valid JSON');
      return {
        taskId: task.id,
        status: 'failed',
        answer: 'A2A response is not valid JSON',
        citations: [],
        latencyMs: Date.now() - startTime,
      };
    }

    // Handle JSON-RPC errors
    if (data?.error) {
      const errMsg = data.error.message ?? 'Unknown JSON-RPC error';
      log.error({ taskId: task.id, code: data.error.code, errMsg }, 'A2A JSON-RPC error');
      return {
        taskId: task.id,
        status: 'failed',
        answer: `A2A JSON-RPC error: ${errMsg}`,
        citations: [],
        latencyMs: Date.now() - startTime,
      };
    }

    // Extract answer from response
    const resultParts = data?.result?.message?.parts ?? [];
    const answerText = resultParts
      .filter((p: any) => p.kind === 'text')
      .map((p: any) => p.text)
      .join('\n');

    // Extract citations if available
    const citations: Citation[] = [];
    const meta = data?.result?.message?.metadata;
    if (meta?.citations && Array.isArray(meta.citations)) {
      for (const c of meta.citations) {
        citations.push({
          source: c.source ?? 'unknown',
          excerpt: c.excerpt,
          relevance: c.relevance,
        });
      }
    }

    return {
      taskId: task.id,
      status: 'completed',
      answer: answerText || 'No answer received from RAG service.',
      citations,
      latencyMs: Date.now() - startTime,
      tokenUsage: meta?.tokenUsage,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(`${this.baseUrl}/.well-known/agent-card.json`, {
          signal: controller.signal,
        });
        return response.ok;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      return false;
    }
  }
}

// ── Factory ──────────────────────────────────────────────────────

/**
 * Create a RAG client based on provider type.
 *
 * @param provider - 'mock' or 'openai' (openai means real A2A client)
 * @param baseUrl - Required for real A2A client
 * @param mockOptions - Optional config for MockRAGClient
 * @param clientOptions - Optional config for A2ARAGClient (timeout, retries)
 */
export function createRAGClient(
  provider: ProviderType,
  baseUrl?: string,
  mockOptions?: MockRAGClientOptions,
  clientOptions?: A2ARAGClientOptions,
): RAGClient {
  switch (provider) {
    case 'mock':
      return new MockRAGClient(mockOptions);
    case 'openai':
      if (!baseUrl) {
        throw new Error('RAG_A2A_URL is required for real RAG client');
      }
      return new A2ARAGClient(baseUrl, clientOptions);
    default:
      throw new Error(`Unknown RAG provider: ${provider}`);
  }
}
