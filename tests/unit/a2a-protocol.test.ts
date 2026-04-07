/**
 * Unit tests for src/wiki-agent/a2a/protocol.ts
 *
 * Tests: agent card, JSON-RPC parsing, request/response formatting.
 */

import { describe, test, expect } from 'bun:test';
import {
  createAgentCard,
  parseJsonRpcRequest,
  createSuccessResponse,
  createErrorResponse,
  extractQueryFromA2ARequest,
  formatAnswerAsA2AResult,
  JSON_RPC_ERRORS,
} from '../../src/wiki-agent/a2a/protocol.ts';
import type { Answer } from '../../src/types.ts';

// Silence logger during tests
process.env.LOG_LEVEL = 'silent';

describe('createAgentCard', () => {
  test('creates agent card with correct port', () => {
    const card = createAgentCard(3838);
    expect(card.name).toBe('wiki-agent');
    expect(card.endpoint).toBe('http://localhost:3838/a2a');
    expect(card.capabilities).toContain('query');
    expect(card.capabilities).toContain('ingest');
    expect(card.capabilities).toContain('lint');
  });

  test('uses custom port', () => {
    const card = createAgentCard(9999);
    expect(card.endpoint).toContain('9999');
  });

  test('includes version', () => {
    const card = createAgentCard(3838);
    expect(card.version).toBeDefined();
    expect(card.version.length).toBeGreaterThan(0);
  });
});

describe('parseJsonRpcRequest', () => {
  test('parses valid request', () => {
    const req = parseJsonRpcRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: { message: { text: 'hello' } },
    });
    expect(req).not.toBeNull();
    expect(req!.jsonrpc).toBe('2.0');
    expect(req!.id).toBe(1);
    expect(req!.method).toBe('message/send');
    expect(req!.params).toEqual({ message: { text: 'hello' } });
  });

  test('parses request with string id', () => {
    const req = parseJsonRpcRequest({
      jsonrpc: '2.0',
      id: 'abc-123',
      method: 'test/method',
    });
    expect(req!.id).toBe('abc-123');
  });

  test('returns null for non-object input', () => {
    expect(parseJsonRpcRequest(null)).toBeNull();
    expect(parseJsonRpcRequest(undefined)).toBeNull();
    expect(parseJsonRpcRequest('string')).toBeNull();
    expect(parseJsonRpcRequest(42)).toBeNull();
  });

  test('returns null for wrong jsonrpc version', () => {
    expect(parseJsonRpcRequest({
      jsonrpc: '1.0',
      id: 1,
      method: 'test',
    })).toBeNull();
  });

  test('returns null for missing id', () => {
    expect(parseJsonRpcRequest({
      jsonrpc: '2.0',
      method: 'test',
    })).toBeNull();
  });

  test('returns null for missing method', () => {
    expect(parseJsonRpcRequest({
      jsonrpc: '2.0',
      id: 1,
    })).toBeNull();
  });

  test('returns null for non-string method', () => {
    expect(parseJsonRpcRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 42,
    })).toBeNull();
  });

  test('handles missing params (optional)', () => {
    const req = parseJsonRpcRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'test',
    });
    expect(req).not.toBeNull();
    expect(req!.params).toBeUndefined();
  });
});

describe('createSuccessResponse', () => {
  test('creates valid success response', () => {
    const resp = createSuccessResponse(1, { status: 'ok' });
    expect(resp.jsonrpc).toBe('2.0');
    expect(resp.id).toBe(1);
    expect(resp.result).toEqual({ status: 'ok' });
    expect(resp.error).toBeUndefined();
  });

  test('supports string id', () => {
    const resp = createSuccessResponse('req-abc', 'done');
    expect(resp.id).toBe('req-abc');
  });
});

describe('createErrorResponse', () => {
  test('creates valid error response', () => {
    const resp = createErrorResponse(1, -32600, 'Invalid request');
    expect(resp.jsonrpc).toBe('2.0');
    expect(resp.id).toBe(1);
    expect(resp.error).toEqual({
      code: -32600,
      message: 'Invalid request',
      data: undefined,
    });
    expect(resp.result).toBeUndefined();
  });

  test('includes error data', () => {
    const resp = createErrorResponse(1, -32603, 'Internal error', { detail: 'stack trace' });
    expect(resp.error!.data).toEqual({ detail: 'stack trace' });
  });

  test('standard error codes are correct', () => {
    expect(JSON_RPC_ERRORS.PARSE_ERROR).toBe(-32700);
    expect(JSON_RPC_ERRORS.INVALID_REQUEST).toBe(-32600);
    expect(JSON_RPC_ERRORS.METHOD_NOT_FOUND).toBe(-32601);
    expect(JSON_RPC_ERRORS.INVALID_PARAMS).toBe(-32602);
    expect(JSON_RPC_ERRORS.INTERNAL_ERROR).toBe(-32603);
  });
});

describe('extractQueryFromA2ARequest', () => {
  test('extracts text from valid A2A message', () => {
    const params = {
      message: {
        kind: 'message',
        messageId: 'msg-1',
        role: 'user',
        parts: [
          { kind: 'text', text: 'What is Meridian?' },
        ],
      },
    };
    expect(extractQueryFromA2ARequest(params)).toBe('What is Meridian?');
  });

  test('concatenates multiple text parts', () => {
    const params = {
      message: {
        parts: [
          { kind: 'text', text: 'First part.' },
          { kind: 'text', text: 'Second part.' },
        ],
      },
    };
    expect(extractQueryFromA2ARequest(params)).toBe('First part.\nSecond part.');
  });

  test('returns null for missing message', () => {
    expect(extractQueryFromA2ARequest({})).toBeNull();
  });

  test('returns null for missing parts', () => {
    expect(extractQueryFromA2ARequest({ message: {} })).toBeNull();
  });

  test('returns null for empty parts array', () => {
    expect(extractQueryFromA2ARequest({ message: { parts: [] } })).toBeNull();
  });

  test('filters non-text parts', () => {
    const params = {
      message: {
        parts: [
          { kind: 'image', data: 'base64...' },
          { kind: 'text', text: 'Only this' },
        ],
      },
    };
    expect(extractQueryFromA2ARequest(params)).toBe('Only this');
  });
});

describe('formatAnswerAsA2AResult', () => {
  test('formats answer as A2A result', () => {
    const answer: Answer = {
      queryId: 'q-1',
      text: 'Meridian is a data platform.',
      citations: [{ source: 'Architecture', relevance: 0.9 }],
      system: 'wiki',
      latencyMs: 120,
      tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    };

    const result = formatAnswerAsA2AResult(answer);
    expect(result.kind).toBe('task');
    expect(result.id).toBe('q-1');

    const message = result.message as any;
    expect(message.role).toBe('agent');
    expect(message.parts[0].text).toBe('Meridian is a data platform.');
    expect(message.metadata.citations).toEqual(answer.citations);
    expect(message.metadata.latencyMs).toBe(120);
  });
});
