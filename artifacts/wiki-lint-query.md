# Deliverable: wiki-lint-query

## Summary
Enhanced lint engine with stale page detection, missing frontmatter field checks, and fix suggestions. Added semantic lint with cross-page contradiction detection. Created both Lint CLI and Query CLI for end-to-end operation.

## Files Created / Modified
- `src/wiki-agent/lint/engine.ts` — Enhanced with: stale page detection (compares source mtime vs page.updated), missing frontmatter field checks, fix suggestions on all issues, semantic lint with cross-page contradiction context, LintOptions for configurable passes
- `src/wiki-agent/lint/cli.ts` — Lint CLI with --wiki-dir, --corpus-dir (stale detection), --no-semantic, --json output, grouped pretty-print output by severity
- `src/wiki-agent/lint/index.ts` — Updated barrel exports with lintStalePages and LintOptions
- `src/wiki-agent/query/cli.ts` — Query CLI accepting positional question, --wiki-dir, --max-pages, --model, --json output, shows citations and token usage
- `tests/unit/lint-enhanced.test.ts` — 12 new tests: missing field detection, fix suggestions, stale page detection, semantic contradiction context, intentionally broken fixtures

## Acceptance Criteria Status
- ☑ Structural lint detects: orphan pages (no inbound links), broken [[wikilinks]], missing frontmatter fields, stale pages (sources updated after last compilation)
- ☑ Semantic lint uses LLM to detect contradictions between pages and knowledge gaps; produces fix suggestions
- ☑ Query engine: routes question via FTS5 index → selects top-K relevant pages → LLM synthesizes answer with [[citations]] back to wiki pages
- ☑ Lint CLI (src/wiki-agent/lint/cli.ts) and Query CLI (src/wiki-agent/query/cli.ts) work end-to-end
- ☑ Unit tests with MockLLM verify lint catches intentionally broken fixtures and query returns cited answers

## Test Results
- 293 tests pass across 20 files (was 281, +12 new)
- 0 failures
- All E2E pipeline tests continue to pass
