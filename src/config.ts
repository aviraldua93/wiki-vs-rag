/**
 * Environment-based configuration for wiki-vs-rag.
 *
 * Loads config from environment variables with sensible defaults.
 * All modules import config from here to ensure consistent settings.
 */

import type { AppConfig, ProviderType } from './types.ts';

/** Resolve a provider type from an environment string. */
function resolveProvider(value: string | undefined, fallback: ProviderType): ProviderType {
  if (value === 'openai' || value === 'mock') return value;
  return fallback;
}

/** Load application configuration from environment variables. */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const hasApiKey = Boolean(env.OPENAI_API_KEY);

  return {
    openaiApiKey: env.OPENAI_API_KEY ?? '',
    ragA2aUrl: env.RAG_A2A_URL ?? 'http://localhost:3737',
    wikiDir: env.WIKI_DIR ?? './wiki',
    corpusDir: env.CORPUS_DIR ?? './corpus',
    logLevel: env.LOG_LEVEL ?? 'info',
    llmProvider: resolveProvider(env.LLM_PROVIDER, hasApiKey ? 'openai' : 'mock'),
    ragProvider: resolveProvider(env.RAG_PROVIDER, 'mock'),
    compileModel: env.COMPILE_MODEL ?? 'gpt-4o-mini',
    judgeModel: env.JUDGE_MODEL ?? 'gpt-4o',
  };
}

/** Singleton config instance. */
let _config: AppConfig | null = null;

/** Get the application config (loads once, caches). */
export function getConfig(): AppConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

/** Reset the cached config (useful for testing). */
export function resetConfig(): void {
  _config = null;
}

export type { AppConfig, ProviderType };
