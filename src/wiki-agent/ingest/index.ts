/**
 * Barrel export for ingest module.
 */

export { ingestDocument, runIngestPipeline } from './pipeline.ts';
export type { IngestOptions, IngestResult } from './pipeline.ts';
export { generateIndexPage, generateOverviewPage } from './generators.ts';
