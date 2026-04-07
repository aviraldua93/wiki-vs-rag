/**
 * Pino logger factory for wiki-vs-rag.
 *
 * Creates structured loggers with module context.
 * Log level is configurable via LOG_LEVEL environment variable.
 */

import pino from 'pino';
import { getConfig } from './config.ts';

/** Root logger instance (created lazily). */
let _rootLogger: pino.Logger | null = null;

/** Get or create the root pino logger. */
function getRootLogger(): pino.Logger {
  if (!_rootLogger) {
    const config = getConfig();
    _rootLogger = pino({
      level: config.logLevel,
      transport:
        config.logLevel === 'debug'
          ? { target: 'pino/file', options: { destination: 1 } }
          : undefined,
      formatters: {
        level(label: string) {
          return { level: label };
        },
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }
  return _rootLogger;
}

/**
 * Create a child logger with module context.
 *
 * @param module - Name of the module (e.g., 'wiki-agent', 'benchmark', 'corpus-loader')
 * @param bindings - Additional key-value pairs to include in every log line
 * @returns A pino child logger instance
 *
 * @example
 * ```ts
 * import { createLogger } from './logger.ts';
 * const log = createLogger('wiki-agent');
 * log.info({ pageCount: 42 }, 'Compilation complete');
 * ```
 */
export function createLogger(
  module: string,
  bindings?: Record<string, unknown>,
): pino.Logger {
  return getRootLogger().child({ module, ...bindings });
}

/** Reset the root logger (useful for testing). */
export function resetLogger(): void {
  _rootLogger = null;
}
