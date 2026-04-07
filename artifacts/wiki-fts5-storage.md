# Deliverable: wiki-fts5-storage

## Summary
Enhanced FTS5 storage with full CRUD operations (createPage, getPage, updatePage, deletePage), wikilink resolution, re-indexing from disk, searchPages alias, getPagesByType, and getBrokenWikilinks methods.

## Files Created / Modified
- `src/wiki-agent/wiki/fts5-storage.ts` — Added createPage (throws on duplicate), updatePage (throws on missing), searchPages alias, resolveWikilink/resolveWikilinks (maps [[PageName]] to file path + metadata), getBrokenWikilinks, getPagesByType, reindexFromDisk (idempotent rebuild from wiki/ directory)
- `src/wiki-agent/wiki/index.ts` — Updated barrel exports with WikilinkResolution type
- `tests/unit/fts5-enhanced.test.ts` — 21 new tests covering CRUD, wikilink resolution, searchPages, getPagesByType, reindexFromDisk (idempotent, nested dirs, search after re-index)

## Acceptance Criteria Status
- ☑ better-sqlite3 database with FTS5 virtual table indexes wiki page title, content, tags, and type
- ☑ CRUD operations: createPage, getPage, updatePage, deletePage, searchPages(query) with relevance ranking
- ☑ Wikilink resolution: given a [[PageName]], resolves to the actual file path and page metadata
- ☑ Re-indexing function rebuilds FTS5 index from wiki/ directory contents (idempotent)
- ☑ Unit tests verify FTS5 search returns relevant results for keyword queries and wikilink resolution works for existing and missing pages

## Test Results
- 281 tests pass across 19 files (was 260, +21 new)
- 0 failures
