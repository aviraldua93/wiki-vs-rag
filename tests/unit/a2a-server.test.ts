/**
 * Unit tests for src/wiki-agent/a2a/server.ts
 *
 * Tests: A2A server agent card endpoint, JSON-RPC message routing,
 * tasks/send, tasks/get, health check, error handling.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { startServer, type A2AServerHandle } from '../../src/wiki-agent/a2a/server.ts';
import { createFTS5Storage, type WikiFTS5Storage } from '../../src/wiki-agent/wiki/fts5-storage.ts';
import { MockLLM } from '../../src/providers/llm.ts';
import type { WikiPage } from '../../src/types.ts';

// Silence logger during tests
process.env.LOG_LEVEL = 'silent';

let server: A2AServerHandle;
let storage: WikiFTS5Storage;
let llm: MockLLM;
let baseUrl: string;

beforeAll(async () => {
  storage = createFTS5Storage(':memory:');
  llm = new MockLLM();

  // Seed some pages for query tests
  const testPage: WikiPage = {
    title: 'Meridian Platform',
    type: 'concept',
    tags: ['platform', 'data'],
    sources: ['technical/meridian.md'],
    content: 'Meridian is a distributed data platform for real-time analytics. It supports [[Stream Processing]] and [[Batch Analytics]].',
    wikilinks: ['Stream Processing', 'Batch Analytics'],
    created: '2026-01-01',
    updated: '2026-01-15',
    filePath: 'concepts/meridian-platform.md',
  };
  storage.upsertPage(testPage);

  // Use port 0 to let the OS pick an available port (avoids EADDRINUSE)
  server = await startServer({
    port: 0,
    storage,
    llm,
    hostname: '127.0.0.1',
    ingestOptions: { wikiDir: './wiki', writeToDisk: false },
  });

  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server?.stop();
  storage?.close();
});

beforeEach(() => {
  llm.reset();
  server.taskStore.clear();
});

// ── Agent Card Tests ─────────────────────────────────────────────

describe('Agent Card', () => {
  test('serves agent card at /.well-known/agent-card.json', async () => {
    const resp = await fetch(`${baseUrl}/.well-known/agent-card.json`);
    expect(resp.ok).toBe(true);
    expect(resp.headers.get('content-type')).toContain('application/json');

    const card = await resp.json();
    expect(card.name).toBe('wiki-agent');
    expect(card.description).toBeDefined();
    expect(card.version).toBe('0.1.0');
    expect(card.capabilities).toContain('query');
    expect(card.capabilities).toContain('ingest');
    expect(card.capabilities).toContain('lint');
    expect(card.endpoint).toContain('/a2a');
  });

  test('agent card has correct structure', async () => {
    const resp = await fetch(`${baseUrl}/.well-known/agent-card.json`);
    const card = await resp.json();

    // All required fields present
    expect(typeof card.name).toBe('string');
    expect(typeof card.description).toBe('string');
    expect(typeof card.version).toBe('string');
    expect(Array.isArray(card.capabilities)).toBe(true);
    expect(typeof card.endpoint).toBe('string');
    expect(card.capabilities.length).toBe(3);
  });

  test('agent card includes CORS headers', async () => {
    const resp = await fetch(`${baseUrl}/.well-known/agent-card.json`);
    expect(resp.headers.get('access-control-allow-origin')).toBe('*');
  });
});

// ── Health Check Tests ───────────────────────────────────────────

describe('Health Check', () => {
  test('returns ok status', async () => {
    const resp = await fetch(`${baseUrl}/health`);
    expect(resp.ok).toBe(true);

    const data = await resp.json();
    expect(data.status).toBe('ok');
    expect(data.agent).toBe('wiki-agent');
    expect(data.version).toBe('0.1.0');
    expect(typeof data.pageCount).toBe('number');
  });
});

// ── JSON-RPC Message/Send Tests ──────────────────────────────────

describe('message/send', () => {
  test('handles query message and returns answer', async () => {
    const resp = await fetch(`${baseUrl}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'test-1',
        method: 'message/send',
        params: {
          message: {
            kind: 'message',
            messageId: 'msg-1',
            role: 'user',
            parts: [{ kind: 'text', text: 'What is Meridian?' }],
          },
        },
      }),
    });

    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.jsonrpc).toBe('2.0');
    expect(data.id).toBe('test-1');
    expect(data.result).toBeDefined();
    expect(data.error).toBeUndefined();

    // Result should be a task with answer
    expect(data.result.kind).toBe('task');
    expect(data.result.message.role).toBe('agent');
    expect(data.result.message.parts[0].kind).toBe('text');
    expect(data.result.message.parts[0].text.length).toBeGreaterThan(0);
  });

  test('handles ingest message', async () => {
    const resp = await fetch(`${baseUrl}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'test-2',
        method: 'message/send',
        params: {
          message: {
            kind: 'message',
            messageId: 'msg-2',
            role: 'user',
            parts: [{ kind: 'text', text: 'ingest: This is a test document about graph databases.' }],
            metadata: { operation: 'ingest', title: 'Graph DBs' },
          },
        },
      }),
    });

    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.result).toBeDefined();
    expect(data.result.success).toBe(true);
    expect(data.result.documentId).toBeDefined();
  });

  test('handles lint message', async () => {
    const resp = await fetch(`${baseUrl}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'test-3',
        method: 'message/send',
        params: {
          message: {
            kind: 'message',
            messageId: 'msg-3',
            role: 'user',
            parts: [{ kind: 'text', text: 'lint' }],
            metadata: { operation: 'lint' },
          },
        },
      }),
    });

    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.result).toBeDefined();
    expect(typeof data.result.pagesChecked).toBe('number');
    expect(typeof data.result.score).toBe('number');
  });

  test('rejects missing message text', async () => {
    const resp = await fetch(`${baseUrl}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'test-4',
        method: 'message/send',
        params: {
          message: {
            kind: 'message',
            parts: [],
          },
        },
      }),
    });

    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe(-32602); // INVALID_PARAMS
  });
});

// ── tasks/send Tests ─────────────────────────────────────────────

describe('tasks/send', () => {
  test('works same as message/send', async () => {
    const resp = await fetch(`${baseUrl}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'task-1',
        method: 'tasks/send',
        params: {
          message: {
            kind: 'message',
            messageId: 'task-msg-1',
            role: 'user',
            parts: [{ kind: 'text', text: 'What is Meridian?' }],
          },
        },
      }),
    });

    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.id).toBe('task-1');
    expect(data.result).toBeDefined();
    expect(data.result.kind).toBe('task');
  });
});

// ── tasks/get Tests ──────────────────────────────────────────────

describe('tasks/get', () => {
  test('retrieves completed task', async () => {
    // First, send a task
    await fetch(`${baseUrl}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'send-1',
        method: 'message/send',
        params: {
          message: {
            kind: 'message',
            messageId: 'get-test-1',
            role: 'user',
            parts: [{ kind: 'text', text: 'What is Meridian?' }],
          },
        },
      }),
    });

    // Then retrieve it
    const resp = await fetch(`${baseUrl}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'get-1',
        method: 'tasks/get',
        params: { id: 'get-test-1' },
      }),
    });

    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.result).toBeDefined();
    expect(data.result.id).toBe('get-test-1');
    expect(data.result.status).toBe('completed');
    expect(data.result.result).toBeDefined();
  });

  test('returns error for unknown task', async () => {
    const resp = await fetch(`${baseUrl}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'get-2',
        method: 'tasks/get',
        params: { id: 'nonexistent-task' },
      }),
    });

    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe(-32602);
  });

  test('returns error for missing task id', async () => {
    const resp = await fetch(`${baseUrl}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'get-3',
        method: 'tasks/get',
        params: {},
      }),
    });

    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.error).toBeDefined();
  });
});

// ── JSON-RPC Error Handling Tests ────────────────────────────────

describe('JSON-RPC Error Handling', () => {
  test('returns parse error for invalid JSON', async () => {
    const resp = await fetch(`${baseUrl}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json at all',
    });

    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe(-32700); // PARSE_ERROR
  });

  test('returns invalid request for non-JSON-RPC body', async () => {
    const resp = await fetch(`${baseUrl}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });

    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe(-32600); // INVALID_REQUEST
  });

  test('returns method not found for unknown methods', async () => {
    const resp = await fetch(`${baseUrl}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'err-1',
        method: 'nonexistent/method',
      }),
    });

    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe(-32601); // METHOD_NOT_FOUND
    expect(data.error.message).toContain('nonexistent/method');
  });

  test('returns 404 for unknown routes', async () => {
    const resp = await fetch(`${baseUrl}/unknown/path`);
    expect(resp.status).toBe(404);
  });

  test('handles CORS preflight', async () => {
    const resp = await fetch(`${baseUrl}/a2a`, { method: 'OPTIONS' });
    expect(resp.status).toBe(204);
    expect(resp.headers.get('access-control-allow-origin')).toBe('*');
    expect(resp.headers.get('access-control-allow-methods')).toContain('POST');
  });
});

// ── Concurrent Request Tests ─────────────────────────────────────

describe('Concurrent Requests', () => {
  test('handles multiple concurrent queries', async () => {
    const queries = Array.from({ length: 5 }, (_, i) => ({
      jsonrpc: '2.0' as const,
      id: `concurrent-${i}`,
      method: 'message/send',
      params: {
        message: {
          kind: 'message',
          messageId: `conc-msg-${i}`,
          role: 'user',
          parts: [{ kind: 'text', text: `Question ${i}: What is Meridian?` }],
        },
      },
    }));

    const responses = await Promise.all(
      queries.map((q) =>
        fetch(`${baseUrl}/a2a`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(q),
        }).then((r) => r.json())
      ),
    );

    for (let i = 0; i < responses.length; i++) {
      expect(responses[i].id).toBe(`concurrent-${i}`);
      expect(responses[i].result).toBeDefined();
      expect(responses[i].error).toBeUndefined();
    }
  });
});

// ── Server Handle Tests ──────────────────────────────────────────

describe('Server Handle', () => {
  test('exposes correct port', () => {
    expect(server.port).toBeGreaterThan(0);
  });

  test('exposes agent card', () => {
    expect(server.agentCard.name).toBe('wiki-agent');
    expect(server.agentCard.capabilities).toContain('query');
  });

  test('exposes task store', () => {
    expect(server.taskStore).toBeDefined();
    expect(typeof server.taskStore.size).toBe('number');
  });
});
