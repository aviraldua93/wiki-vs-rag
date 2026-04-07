/**
 * HTTP server for wiki-vs-rag dashboard and API.
 *
 * Serves:
 * - / — Static dashboard from src/server/static/
 * - /api/results — Latest benchmark results JSON
 * - /api/results/:id — Specific benchmark run by ID
 * - /health — Server health check
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createLogger } from '../logger.ts';
import { getConfig } from '../config.ts';
import type { BenchmarkRun } from '../types.ts';

const log = createLogger('http-server');

/** MIME types for static file serving. */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** Options for the HTTP server. */
export interface HttpServerOptions {
  /** Port to bind (default: 3939) */
  port?: number;
  /** Hostname to bind (default: '0.0.0.0') */
  hostname?: string;
  /** Directory containing static files */
  staticDir?: string;
  /** Directory containing benchmark results */
  resultsDir?: string;
}

/** Server handle returned by startHttpServer. */
export interface HttpServerHandle {
  server: any;
  port: number;
  stop(): void;
}

/**
 * Load all benchmark result files from the results directory.
 */
async function loadBenchmarkResults(resultsDir: string): Promise<BenchmarkRun[]> {
  const runs: BenchmarkRun[] = [];

  try {
    const files = await readdir(resultsDir);
    const jsonFiles = files.filter((f) => f.startsWith('benchmark-') && f.endsWith('.json'));

    for (const file of jsonFiles) {
      try {
        const content = await readFile(join(resultsDir, file), 'utf-8');
        const run = JSON.parse(content) as BenchmarkRun;
        runs.push(run);
      } catch (err) {
        log.warn({ file, err }, 'Failed to parse benchmark result file');
      }
    }
  } catch {
    // Results directory may not exist yet
    log.debug({ resultsDir }, 'Results directory not found or empty');
  }

  // Sort by completion date, most recent first
  runs.sort((a, b) => {
    const dateA = a.completedAt ?? a.startedAt;
    const dateB = b.completedAt ?? b.startedAt;
    return dateB.localeCompare(dateA);
  });

  return runs;
}

/**
 * Serve a static file from the static directory.
 */
async function serveStaticFile(
  staticDir: string,
  filePath: string,
): Promise<Response | null> {
  // Prevent directory traversal
  const normalized = filePath.replace(/\\/g, '/').replace(/\.\./g, '');
  const fullPath = join(staticDir, normalized);

  try {
    const content = await readFile(fullPath);
    const ext = extname(fullPath);
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

    return new Response(content, {
      status: 200,
      headers: { 'Content-Type': contentType },
    });
  } catch {
    return null;
  }
}

/**
 * Create and start the HTTP dashboard server.
 *
 * @param options - Server configuration
 * @returns Server handle with stop() method
 */
export async function startHttpServer(options?: HttpServerOptions): Promise<HttpServerHandle> {
  const port = options?.port ?? 3939;
  const hostname = options?.hostname ?? '0.0.0.0';
  const staticDir = options?.staticDir ?? join(import.meta.dir, 'static');
  const resultsDir = options?.resultsDir ?? './results';

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  const server = Bun.serve({
    port,
    hostname,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const path = url.pathname;

      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      // /health
      if (path === '/health') {
        return new Response(JSON.stringify({ status: 'ok', service: 'wiki-vs-rag-dashboard' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // /api/results — List all benchmark runs
      if (path === '/api/results') {
        const runs = await loadBenchmarkResults(resultsDir);
        return new Response(JSON.stringify(runs), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // /api/results/:id — Get specific benchmark run
      if (path.startsWith('/api/results/')) {
        const runId = path.slice('/api/results/'.length);
        const runs = await loadBenchmarkResults(resultsDir);
        const run = runs.find((r) => r.id === runId);

        if (!run) {
          return new Response(JSON.stringify({ error: `Benchmark run not found: ${runId}` }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify(run), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Static files — serve from staticDir
      let filePath = path === '/' ? '/index.html' : path;

      const staticResponse = await serveStaticFile(staticDir, filePath);
      if (staticResponse) {
        return staticResponse;
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    },
  });

  const actualPort = server.port;
  log.info({ port: actualPort, hostname, staticDir, resultsDir }, 'HTTP dashboard server started');

  return {
    server,
    port: actualPort,
    stop() {
      server.stop();
      log.info('HTTP dashboard server stopped');
    },
  };
}
