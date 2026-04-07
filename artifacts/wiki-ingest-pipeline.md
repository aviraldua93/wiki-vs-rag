# Deliverable: wiki-ingest-pipeline

## Summary
Built the complete document ingestion pipeline (loader → extractor → compiler → wiki pages) with CLI interface, LLM-powered entity/concept extraction, YAML frontmatter + [[wikilinks]] generation, and auto-generated index.md/overview.md files.

## Files Created / Modified
- `src/wiki-agent/ingest/cli.ts` — CLI accepting --dir flag for corpus directory, --wiki-dir, --no-disk, --model, --db-path options
- `src/wiki-agent/ingest/generators.ts` — Auto-generates index.md (master catalog by type) and overview.md (statistics, tags, source documents)
- `src/wiki-agent/ingest/pipeline.ts` — Enhanced with entity/concept extraction (extractSubPages option), improved compilation prompts, sub-page generation for entities (wiki/entities/) and concepts (wiki/concepts/)
- `src/wiki-agent/ingest/index.ts` — Updated barrel exports with generators
- `tests/unit/generators.test.ts` — 8 tests for index.md and overview.md generation
- `tests/unit/ingest-enhanced.test.ts` — 10 tests for enhanced pipeline (frontmatter validation, wikilink quality, entity/concept extraction, FTS5 indexing)

## Acceptance Criteria Status
- ☑ CLI (src/wiki-agent/ingest/cli.ts) accepts --dir flag pointing to corpus directory
- ☑ For each corpus document, LLM extracts entities, concepts, and key facts, then compiles into wiki pages with YAML frontmatter matching the schema (title, type, tags, sources, created, updated)
- ☑ Generated pages contain [[WikiLinks]] cross-referencing related entities and concepts; links use Obsidian-compatible format
- ☑ Compiled pages are written to wiki/sources/, wiki/entities/, wiki/concepts/ directories; index.md and overview.md are auto-generated
- ☑ Unit tests using MockLLM verify the full pipeline produces valid wiki pages with correct frontmatter and wikilinks

## Test Results
- 260 tests pass across 18 files (was 242 before, +18 new)
- 0 failures
