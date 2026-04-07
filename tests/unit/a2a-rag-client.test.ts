/**
 * Unit tests for A2A RAG client error handling and HTTP dashboard server.
 *
 * Tests: connection errors, timeouts, malformed responses, MockRAGClient,
 * and HTTP server static file serving + /api/results endpoint.
 */

import { describe, test, expect, beforeAll, afterAll, afterEach } from 'bun:test';
import { MockRAGClient, A2ARAGClient, A2AClientError } from '../../src/providers/rag-client.ts';
import { startHttpServer, type HttpServerHandle } from '../../src/server/index.ts';
import type { A2ATask } from '../../src/types.ts';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

// Silence logger during tests
process.env.LOG_LEVEL = 'silent';

// ── MockRAGClient Error Handling Tests ───────────────────────────

describe('MockRAGClient', () => {
  test('returns failed status when shouldFail is true', async () => {
    const client = new MockRAGClient({ shouldFail: true });
    const task: A2ATask = { id: 'test-1', message: 'What is X?' };
    const result = await client.query(task);

    expect(result.status).toBe('failed');
    expect(result.taskId).toBe('test-1');
    expect(result.answer).toBe('');
  });

  test('simulates latency', async () => {
    const client = new MockRAGClient({ latencyMs: 50 });
    const task: A2ATask = { id: 'test-2', message: 'Quick question' };
    const start = Date.now();
    await client.query(task);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(40); // allow 10ms slack
  });

  test('returns custom response for matching pattern', async () => {
    const client = new MockRAGClient({
      responseMap: { 'meridian': 'Meridian is a data platform.' },
    });
    const task: A2ATask = { id: 'test-3', message: 'Tell me about Meridian' };
    const result = await client.query(task);

    expect(result.status).toBe('completed');
    expect(result.answer).toBe('Meridian is a data platform.');
  });

  test('returns default answer when no pattern matches', async () => {
    const client = new MockRAGClient({ defaultAnswer: 'Default response' });
    const task: A2ATask = { id: 'test-4', message: 'Some random question' };
    const result = await client.query(task);

    expect(result.answer).toBe('Default response');
  });

  test('health check returns configured value', async () => {
    const healthy = new MockRAGClient({ healthy: true });
    const unhealthy = new MockRAGClient({ healthy: false });

    expect(await healthy.healthCheck()).toBe(true);
    expect(await unhealthy.healthCheck()).toBe(false);
  });

  test('tracks call count and log', async () => {
    const client = new MockRAGClient();
    expect(client.getCallCount()).toBe(0);

    await client.query({ id: 't1', message: 'Q1' });
    await client.query({ id: 't2', message: 'Q2' });

    expect(client.getCallCount()).toBe(2);
    expect(client.getCallLog().length).toBe(2);
    expect(client.getCallLog()[0].task.id).toBe('t1');
  });

  test('reset clears state', async () => {
    const client = new MockRAGClient();
    await client.query({ id: 't1', message: 'Q1' });
    expect(client.getCallCount()).toBe(1);

    client.reset();
    expect(client.getCallCount()).toBe(0);
    expect(client.getCallLog().length).toBe(0);
  });

  test('configure updates options at runtime', async () => {
    const client = new MockRAGClient({ healthy: true });
    expect(await client.healthCheck()).toBe(true);

    client.configure({ healthy: false });
    expect(await client.healthCheck()).toBe(false);
  });

  test('includes token usage in result', async () => {
    const client = new MockRAGClient();
    const result = await client.query({ id: 't1', message: 'A test question' });

    expect(result.tokenUsage).toBeDefined();
    expect(result.tokenUsage!.promptTokens).toBeGreaterThan(0);
    expect(result.tokenUsage!.completionTokens).toBeGreaterThan(0);
    expect(result.tokenUsage!.totalTokens).toBeGreaterThan(0);
  });

  test('includes citations in result', async () => {
    const client = new MockRAGClient();
    const result = await client.query({ id: 't1', message: 'Test query' });

    expect(result.citations.length).toBe(2);
    expect(result.citations[0].source).toContain('mock-rag');
    expect(typeof result.citations[0].relevance).toBe('number');
  });
});

// ── A2ARAGClient Error Handling Tests ────────────────────────────

describe('A2ARAGClient Error Handling', () => {
  test('handles connection refused gracefully', async () => {
    // Connect to a port that nothing is listening on
    const client = new A2ARAGClient('http://127.0.0.1:19999', { timeoutMs: 2000 });
    const task: A2ATask = { id: 'conn-1', message: 'test' };
    const result = await client.query(task);

    expect(result.status).toBe('failed');
    expect(result.taskId).toBe('conn-1');
    expect(result.answer).toContain('connection error');
    expect(result.latencyMs).toBeGreaterThan(0);
  });

  test('handles timeout gracefully', async () => {
    // Start a server that never responds
    const slowServer = Bun.serve({
      port: 0, // random port
      hostname: '127.0.0.1',
      fetch: () => new Promise(() => {}), // never resolves
    });

    try {
      const client = new A2ARAGClient(
        `http://127.0.0.1:${slowServer.port}`,
        { timeoutMs: 200 },
      );
      const task: A2ATask = { id: 'timeout-1', message: 'test' };
      const result = await client.query(task);

      expect(result.status).toBe('failed');
      expect(result.answer).toContain('timed out');
    } finally {
      slowServer.stop();
    }
  });

  test('handles HTTP error status codes', async () => {
    const errorServer = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () => new Response('Internal Server Error', { status: 500 }),
    });

    try {
      const client = new A2ARAGClient(`http://127.0.0.1:${errorServer.port}`);
      const task: A2ATask = { id: 'http-err-1', message: 'test' };
      const result = await client.query(task);

      expect(result.status).toBe('failed');
      expect(result.answer).toContain('500');
    } finally {
      errorServer.stop();
    }
  });

  test('handles malformed JSON response', async () => {
    const badJsonServer = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () => new Response('not json at all', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    try {
      const client = new A2ARAGClient(`http://127.0.0.1:${badJsonServer.port}`);
      const task: A2ATask = { id: 'bad-json-1', message: 'test' };
      const result = await client.query(task);

      expect(result.status).toBe('failed');
      expect(result.answer).toContain('not valid JSON');
    } finally {
      badJsonServer.stop();
    }
  });

  test('handles JSON-RPC error response', async () => {
    const rpcErrorServer = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () => new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32603, message: 'Internal processing error' },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    try {
      const client = new A2ARAGClient(`http://127.0.0.1:${rpcErrorServer.port}`);
      const task: A2ATask = { id: 'rpc-err-1', message: 'test' };
      const result = await client.query(task);

      expect(result.status).toBe('failed');
      expect(result.answer).toContain('Internal processing error');
    } finally {
      rpcErrorServer.stop();
    }
  });

  test('handles empty result parts', async () => {
    const emptyServer = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () => new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { message: { parts: [] } },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    try {
      const client = new A2ARAGClient(`http://127.0.0.1:${emptyServer.port}`);
      const task: A2ATask = { id: 'empty-1', message: 'test' };
      const result = await client.query(task);

      expect(result.status).toBe('completed');
      expect(result.answer).toBe('No answer received from RAG service.');
    } finally {
      emptyServer.stop();
    }
  });

  test('extracts citations from response metadata', async () => {
    const citationServer = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () => new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          message: {
            parts: [{ kind: 'text', text: 'Answer with citations' }],
            metadata: {
              citations: [
                { source: 'doc1.md', excerpt: 'Excerpt 1', relevance: 0.9 },
                { source: 'doc2.md', relevance: 0.7 },
              ],
            },
          },
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    try {
      const client = new A2ARAGClient(`http://127.0.0.1:${citationServer.port}`);
      const task: A2ATask = { id: 'cite-1', message: 'test' };
      const result = await client.query(task);

      expect(result.status).toBe('completed');
      expect(result.citations.length).toBe(2);
      expect(result.citations[0].source).toBe('doc1.md');
      expect(result.citations[0].relevance).toBe(0.9);
    } finally {
      citationServer.stop();
    }
  });

  test('healthCheck returns false on connection error', async () => {
    const client = new A2ARAGClient('http://127.0.0.1:19998');
    expect(await client.healthCheck()).toBe(false);
  });

  test('healthCheck returns true for healthy service', async () => {
    const healthyServer = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: (req) => {
        if (new URL(req.url).pathname === '/.well-known/agent-card.json') {
          return new Response(JSON.stringify({ name: 'test' }), { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      },
    });

    try {
      const client = new A2ARAGClient(`http://127.0.0.1:${healthyServer.port}`);
      expect(await client.healthCheck()).toBe(true);
    } finally {
      healthyServer.stop();
    }
  });
});

// ── A2AClientError Tests ─────────────────────────────────────────

describe('A2AClientError', () => {
  test('creates error with all fields', () => {
    const err = new A2AClientError('timeout', 'Request timed out', 'task-1', 408);
    expect(err.kind).toBe('timeout');
    expect(err.message).toBe('Request timed out');
    expect(err.taskId).toBe('task-1');
    expect(err.statusCode).toBe(408);
    expect(err.name).toBe('A2AClientError');
    expect(err instanceof Error).toBe(true);
  });

  test('creates error with minimal fields', () => {
    const err = new A2AClientError('connection_error', 'Connection refused');
    expect(err.kind).toBe('connection_error');
    expect(err.taskId).toBeUndefined();
    expect(err.statusCode).toBeUndefined();
  });
});

// ── HTTP Dashboard Server Tests ──────────────────────────────────

describe('HTTP Dashboard Server', () => {
  let httpServer: HttpServerHandle;
  let httpBaseUrl: string;
  const TEST_RESULTS_DIR = join(import.meta.dir, '../../.test-results-' + Date.now());
  const STATIC_DIR = join(import.meta.dir, '../../src/server/static');

  beforeAll(async () => {
    // Create test results directory with a sample benchmark result
    await mkdir(TEST_RESULTS_DIR, { recursive: true });
    const sampleRun = {
      id: 'test-run-001',
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T00:05:00Z',
      results: [
        {
          query: { id: 'q1', text: 'What is X?', category: 'single-hop' },
          wikiAnswer: { queryId: 'q1', text: 'X is Y', citations: [], system: 'wiki', latencyMs: 100 },
          ragAnswer: { queryId: 'q1', text: 'X is Z', citations: [], system: 'rag', latencyMs: 200 },
          winner: 'wiki',
          timestamp: '2026-01-01T00:01:00Z',
        },
      ],
      summary: {
        totalQueries: 1,
        wikiWins: 1,
        ragWins: 0,
        ties: 0,
        avgWikiLatencyMs: 100,
        avgRagLatencyMs: 200,
        totalWikiCostUsd: 0.001,
        totalRagCostUsd: 0.002,
        byCategory: { 'single-hop': { wikiWins: 1, ragWins: 0, ties: 0 } },
      },
    };
    await writeFile(
      join(TEST_RESULTS_DIR, 'benchmark-test-run-001.json'),
      JSON.stringify(sampleRun, null, 2),
    );

    // Start server on random port
    const httpPort = 49300 + Math.floor(Math.random() * 1000);
    httpServer = await startHttpServer({
      port: httpPort,
      hostname: '127.0.0.1',
      staticDir: STATIC_DIR,
      resultsDir: TEST_RESULTS_DIR,
    });
    httpBaseUrl = `http://127.0.0.1:${httpPort}`;
  });

  afterAll(async () => {
    httpServer?.stop();
    await rm(TEST_RESULTS_DIR, { recursive: true, force: true });
  });

  test('serves dashboard at /', async () => {
    const resp = await fetch(`${httpBaseUrl}/`);
    expect(resp.ok).toBe(true);
    expect(resp.headers.get('content-type')).toContain('text/html');

    const html = await resp.text();
    expect(html).toContain('Wiki vs');
    expect(html).toContain('RAG');
    expect(html).toContain('Benchmark Dashboard');
  });

  test('serves /api/results with benchmark data', async () => {
    const resp = await fetch(`${httpBaseUrl}/api/results`);
    expect(resp.ok).toBe(true);
    expect(resp.headers.get('content-type')).toContain('application/json');

    const runs = await resp.json();
    expect(Array.isArray(runs)).toBe(true);
    expect(runs.length).toBe(1);
    expect(runs[0].id).toBe('test-run-001');
    expect(runs[0].summary.totalQueries).toBe(1);
    expect(runs[0].summary.wikiWins).toBe(1);
  });

  test('serves /api/results/:id for specific run', async () => {
    const resp = await fetch(`${httpBaseUrl}/api/results/test-run-001`);
    expect(resp.ok).toBe(true);

    const run = await resp.json();
    expect(run.id).toBe('test-run-001');
    expect(run.results.length).toBe(1);
  });

  test('returns 404 for unknown benchmark run', async () => {
    const resp = await fetch(`${httpBaseUrl}/api/results/nonexistent`);
    expect(resp.status).toBe(404);

    const data = await resp.json();
    expect(data.error).toContain('not found');
  });

  test('health check returns ok', async () => {
    const resp = await fetch(`${httpBaseUrl}/health`);
    expect(resp.ok).toBe(true);

    const data = await resp.json();
    expect(data.status).toBe('ok');
    expect(data.service).toBe('wiki-vs-rag-dashboard');
  });

  test('returns 404 for unknown routes', async () => {
    const resp = await fetch(`${httpBaseUrl}/nonexistent`);
    expect(resp.status).toBe(404);
  });

  test('includes CORS headers', async () => {
    const resp = await fetch(`${httpBaseUrl}/api/results`);
    expect(resp.headers.get('access-control-allow-origin')).toBe('*');
  });
});
