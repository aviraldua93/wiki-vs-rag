/**
 * Barrel export for wiki module.
 */

export { parseWikiPage, serializeWikiPage, extractWikilinks, validateWikiPage } from './page.ts';
export { WikiFTS5Storage, createFTS5Storage } from './fts5-storage.ts';
export type { SearchResult, WikilinkResolution } from './fts5-storage.ts';
