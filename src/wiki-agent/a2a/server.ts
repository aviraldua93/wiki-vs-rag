/**
 * A2A wiki-agent server — HTTP server implementing JSON-RPC 2.0 protocol.
 *
 * Serves:
 * - /.well-known/agent-card.json — Agent capability discovery
 * - /a2a — JSON-RPC 2.0 endpoint (tasks/send, tasks/get, message/send)
 * - /health — Health check endpoint
 *
 * Message routing:
 * - 'query' messages → wiki query engine (FTS5 search + LLM synthesis)
 * - 'ingest' messages → ingest pipeline
 * - 'lint' messages → lint engine
 */

import { v4 as uuid } from 'uuid';
import type { Query, Answer, LLMProvider, WikiPage } from '../../types.ts';
import type { WikiFTS5Storage } from '../wiki/fts5-storage.ts';
import { executeQuery } from '../query/engine.ts';
import { runLint } from '../lint/engine.ts';
import { ingestDocument, type IngestOptions } from '../ingest/pipeline.ts';
import {
  createAgentCard,
  parseJsonRpcRequest,
  createSuccessResponse,
  createErrorResponse,
  extractQueryFromA2ARequest,
  formatAnswerAsA2AResult,
  JSON_RPC_ERRORS,
  type AgentCard,
  type JsonRpcResponse,
} from './protocol.ts';
import { createLogger } from '../../logger.ts';

const log = createLogger('a2a-server');

// ── Task Store ───────────────────────────────────────────────────

/** In-memory task state for tasks/get retrieval. */
export interface TaskRecord {
  id: string;
  status: 'submitted' | 'working' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** In-memory task store. */
class TaskStore {
  private tasks = new Map<string, TaskRecord>();

  create(id: string): TaskRecord {
    const now = new Date().toISOString();
    const record: TaskRecord = {
      id,
      status: 'submitted',
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(id, record);
    return record;
  }

  get(id: string): TaskRecord | undefined {
    return this.tasks.get(id);
  }

  update(id: string, updates: Partial<TaskRecord>): TaskRecord | undefined {
    const record = this.tasks.get(id);
    if (!record) return undefined;
    Object.assign(record, updates, { updatedAt: new Date().toISOString() });
    return record;
  }

  clear(): void {
    this.tasks.clear();
  }

  get size(): number {
    return this.tasks.size;
  }
}

// ── Server Options ───────────────────────────────────────────────

/** Configuration options for the A2A server. */
export interface A2AServerOptions {
  /** Port to bind (default: 3838) */
  port?: number;
  /** Wiki FTS5 storage instance */
  storage: WikiFTS5Storage;
  /** LLM provider for query synthesis and lint */
  llm: LLMProvider;
  /** Ingest options (wiki dir, etc.) */
  ingestOptions?: IngestOptions;
  /** Hostname to bind (default: '0.0.0.0') */
  hostname?: string;
}

// ── Message Type Detection ───────────────────────────────────────

type MessageOperation = 'query' | 'ingest' | 'lint' | 'unknown';

/**
 * Detect the operation type from message text and metadata.
 */
function detectOperation(text: string, metadata?: Record<string, unknown>): MessageOperation {
  // Check metadata first
  if (metadata?.operation) {
    const op = String(metadata.operation).toLowerCase();
    if (op === 'query' || op === 'ingest' || op === 'lint') return op;
  }

  const lower = text.toLowerCase().trim();

  // Ingest detection
  if (lower.startsWith('ingest:') || lower.startsWith('ingest ') ||
      metadata?.type === 'ingest') {
    return 'ingest';
  }

  // Lint detection
  if (lower.startsWith('lint') || lower === 'run lint' ||
      metadata?.type === 'lint') {
    return 'lint';
  }

  // Default to query
  return 'query';
}

// ── Request Handlers ─────────────────────────────────────────────

/**
 * Handle a 'query' operation — search wiki and synthesize answer.
 */
async function handleQuery(
  text: string,
  storage: WikiFTS5Storage,
  llm: LLMProvider,
  metadata?: Record<string, unknown>,
): Promise<Answer> {
  const queryId = (metadata?.queryId as string) ?? uuid();
  const query: Query = {
    id: queryId,
    text,
    category: (metadata?.category as any) ?? undefined,
  };
  return executeQuery(query, storage, llm);
}

/**
 * Handle an 'ingest' operation — ingest a document into the wiki.
 */
async function handleIngest(
  text: string,
  storage: WikiFTS5Storage,
  llm: LLMProvider,
  ingestOptions?: IngestOptions,
  metadata?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // Extract the document content from the message
  const docTitle = (metadata?.title as string) ?? 'Untitled Document';
  const docId = (metadata?.documentId as string) ?? uuid();
  const category = (metadata?.category as any) ?? 'technical';

  const corpusDoc = {
    id: docId,
    title: docTitle,
    content: text.replace(/^ingest:\s*/i, ''),
    filePath: `inline/${docId}.md`,
    relativePath: `inline/${docId}.md`,
    category,
    metadata: {},
    sizeBytes: text.length,
  };

  const result = await ingestDocument(
    corpusDoc,
    llm,
    storage,
    ingestOptions ?? { wikiDir: './wiki', writeToDisk: false },
  );

  return {
    documentId: result.documentId,
    success: result.success,
    pageTitle: result.page?.title,
    subPages: result.subPages?.map((p) => p.title) ?? [],
    error: result.error,
  };
}

/**
 * Handle a 'lint' operation — lint the wiki pages.
 */
async function handleLint(
  storage: WikiFTS5Storage,
  llm: LLMProvider,
): Promise<Record<string, unknown>> {
  const result = await runLint(storage, llm, { semantic: false });
  return {
    pagesChecked: result.pagesChecked,
    pagesWithIssues: result.pagesWithIssues,
    score: result.score,
    issueCount: result.issues.length,
    issues: result.issues.slice(0, 20), // limit to first 20
    suggestions: result.suggestions.slice(0, 10),
  };
}

// ── JSON-RPC Method Handlers ─────────────────────────────────────

/**
 * Handle message/send and tasks/send — the main entry point.
 */
async function handleMessageSend(
  params: Record<string, unknown>,
  storage: WikiFTS5Storage,
  llm: LLMProvider,
  taskStore: TaskStore,
  ingestOptions?: IngestOptions,
): Promise<JsonRpcResponse & { _id: string | number }> {
  const text = extractQueryFromA2ARequest(params);
  if (!text) {
    return {
      ...createErrorResponse(0, JSON_RPC_ERRORS.INVALID_PARAMS, 'Missing message text'),
      _id: 0,
    };
  }

  const message = params.message as Record<string, unknown> | undefined;
  const metadata = (message?.metadata as Record<string, unknown>) ?? undefined;
  const messageId = (message?.messageId as string) ?? uuid();
  const operation = detectOperation(text, metadata);

  // Create task record
  const task = taskStore.create(messageId);
  taskStore.update(messageId, { status: 'working' });

  log.info({ messageId, operation, textLength: text.length }, 'Processing message');

  try {
    let result: unknown;

    switch (operation) {
      case 'query': {
        const answer = await handleQuery(text, storage, llm, metadata);
        result = formatAnswerAsA2AResult(answer);
        break;
      }
      case 'ingest': {
        result = await handleIngest(text, storage, llm, ingestOptions, metadata);
        break;
      }
      case 'lint': {
        result = await handleLint(storage, llm);
        break;
      }
      default: {
        const answer = await handleQuery(text, storage, llm, metadata);
        result = formatAnswerAsA2AResult(answer);
      }
    }

    taskStore.update(messageId, { status: 'completed', result });
    return { ...createSuccessResponse(0, result), _id: 0 };
  } catch (err: any) {
    const errorMsg = err.message ?? String(err);
    taskStore.update(messageId, { status: 'failed', error: errorMsg });
    log.error({ messageId, err }, 'Message processing failed');
    return {
      ...createErrorResponse(0, JSON_RPC_ERRORS.INTERNAL_ERROR, errorMsg),
      _id: 0,
    };
  }
}

/**
 * Handle tasks/get — retrieve task status and result.
 */
function handleTasksGet(
  params: Record<string, unknown>,
  taskStore: TaskStore,
): JsonRpcResponse {
  const taskId = params.id as string;
  if (!taskId) {
    return createErrorResponse(0, JSON_RPC_ERRORS.INVALID_PARAMS, 'Missing task id');
  }

  const task = taskStore.get(taskId);
  if (!task) {
    return createErrorResponse(0, JSON_RPC_ERRORS.INVALID_PARAMS, `Task not found: ${taskId}`);
  }

  return createSuccessResponse(0, {
    id: task.id,
    status: task.status,
    result: task.result,
    error: task.error,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  });
}

// ── Server Creation ──────────────────────────────────────────────

/** Running server handle (returned by startServer). */
export interface A2AServerHandle {
  /** The underlying Bun server object */
  server: any;
  /** Port the server is listening on */
  port: number;
  /** The agent card */
  agentCard: AgentCard;
  /** The task store for inspection */
  taskStore: TaskStore;
  /** Stop the server */
  stop(): void;
}

/**
 * Create and start the A2A wiki-agent server.
 *
 * @param options - Server configuration
 * @returns Server handle with stop() method
 */
export async function startServer(options: A2AServerOptions): Promise<A2AServerHandle> {
  const port = options.port ?? 3838;
  const hostname = options.hostname ?? '0.0.0.0';
  const { storage, llm, ingestOptions } = options;

  const agentCard = createAgentCard(port);
  const agentCardJson = JSON.stringify(agentCard, null, 2);
  const taskStore = new TaskStore();

  const server = Bun.serve({
    port,
    hostname,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const path = url.pathname;

      // CORS headers for all responses
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };

      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      // /.well-known/agent-card.json — Agent card discovery
      if (path === '/.well-known/agent-card.json') {
        return new Response(agentCardJson, {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // /health — Health check
      if (path === '/health') {
        return new Response(JSON.stringify({
          status: 'ok',
          agent: agentCard.name,
          version: agentCard.version,
          pageCount: storage.getPageCount(),
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // /a2a — JSON-RPC 2.0 endpoint
      if (path === '/a2a' && req.method === 'POST') {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          const resp = createErrorResponse(0, JSON_RPC_ERRORS.PARSE_ERROR, 'Invalid JSON');
          return new Response(JSON.stringify(resp), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const rpcReq = parseJsonRpcRequest(body);
        if (!rpcReq) {
          const resp = createErrorResponse(0, JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid JSON-RPC request');
          return new Response(JSON.stringify(resp), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        let rpcResp: JsonRpcResponse;

        switch (rpcReq.method) {
          case 'message/send':
          case 'tasks/send': {
            const result = await handleMessageSend(
              rpcReq.params ?? {},
              storage,
              llm,
              taskStore,
              ingestOptions,
            );
            // Set the correct id from the request
            rpcResp = { ...result, id: rpcReq.id };
            delete (rpcResp as any)._id;
            break;
          }

          case 'tasks/get': {
            rpcResp = handleTasksGet(rpcReq.params ?? {}, taskStore);
            rpcResp.id = rpcReq.id;
            break;
          }

          default: {
            rpcResp = createErrorResponse(
              rpcReq.id,
              JSON_RPC_ERRORS.METHOD_NOT_FOUND,
              `Method not found: ${rpcReq.method}`,
            );
          }
        }

        return new Response(JSON.stringify(rpcResp), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 404 for everything else
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    },
  });

  const actualPort = server.port;
  log.info({ port: actualPort, hostname, agent: agentCard.name }, 'A2A server started');

  return {
    server,
    port: actualPort,
    agentCard,
    taskStore,
    stop() {
      server.stop();
      log.info('A2A server stopped');
    },
  };
}

export { TaskStore };
