/**
 * Barrel export for ingest module.
 */

export { ingestDocument, runIngestPipeline } from './pipeline.ts';
export type { IngestOptions, IngestResult } from './pipeline.ts';
export { generateIndexPage, generateOverviewPage, appendToLog } from './generators.ts';
