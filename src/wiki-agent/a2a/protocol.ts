/**
 * A2A protocol types and helpers for wiki-agent server.
 *
 * Implements the JSON-RPC 2.0 based A2A protocol for the wiki agent.
 */

import type { Query, Answer } from '../../types.ts';
import { createLogger } from '../../logger.ts';

const log = createLogger('a2a-protocol');

/** A2A Agent Card describing capabilities. */
export interface AgentCard {
  name: string;
  description: string;
  version: string;
  capabilities: string[];
  endpoint: string;
}

/** JSON-RPC 2.0 request. */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 response. */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

/** JSON-RPC 2.0 error. */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** A2A message part. */
export interface MessagePart {
  kind: 'text';
  text: string;
}

/** A2A message. */
export interface A2AMessage {
  kind: 'message';
  messageId: string;
  role: 'user' | 'agent';
  parts: MessagePart[];
  metadata?: Record<string, unknown>;
}

/**
 * Create the wiki agent card.
 */
export function createAgentCard(port: number): AgentCard {
  return {
    name: 'wiki-agent',
    description: 'Karpathy-style LLM Wiki Knowledge Compiler — answers questions from compiled wiki knowledge',
    version: '0.1.0',
    capabilities: ['query', 'ingest', 'lint'],
    endpoint: `http://localhost:${port}/a2a`,
  };
}

/**
 * Parse a JSON-RPC request from raw body.
 */
export function parseJsonRpcRequest(body: unknown): JsonRpcRequest | null {
  if (!body || typeof body !== 'object') return null;

  const req = body as Record<string, unknown>;
  if (req.jsonrpc !== '2.0') return null;
  if (!req.id) return null;
  if (typeof req.method !== 'string') return null;

  return {
    jsonrpc: '2.0',
    id: req.id as string | number,
    method: req.method,
    params: (req.params as Record<string, unknown>) ?? undefined,
  };
}

/**
 * Create a JSON-RPC success response.
 */
export function createSuccessResponse(id: string | number, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

/**
 * Create a JSON-RPC error response.
 */
export function createErrorResponse(
  id: string | number,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, data },
  };
}

/**
 * Extract query text from an A2A message/send request.
 */
export function extractQueryFromA2ARequest(params: Record<string, unknown>): string | null {
  const message = params.message as Record<string, unknown> | undefined;
  if (!message) return null;

  const parts = message.parts as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(parts)) return null;

  const textParts = parts
    .filter((p) => p.kind === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string);

  return textParts.length > 0 ? textParts.join('\n') : null;
}

/**
 * Format an Answer as an A2A response result.
 */
export function formatAnswerAsA2AResult(answer: Answer): Record<string, unknown> {
  return {
    kind: 'task',
    id: answer.queryId,
    status: { state: 'completed' },
    message: {
      kind: 'message',
      messageId: `response-${answer.queryId}`,
      role: 'agent',
      parts: [
        { kind: 'text', text: answer.text },
      ],
      metadata: {
        citations: answer.citations,
        latencyMs: answer.latencyMs,
        tokenUsage: answer.tokenUsage,
      },
    },
  };
}

// Standard JSON-RPC error codes
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;
