# Agent Instructions — wiki-vs-rag

## Project Overview
Head-to-head benchmark: RAG vs Karpathy-style LLM Wiki Knowledge Compilation.
Two systems answer the same questions over the same corpus. Metrics determine which wins.

## Architecture
- `src/wiki-agent/` — Karpathy-style knowledge compiler (ingest → compile → lint → query)
- `src/benchmark/` — Evaluation harness calling both wiki-agent AND rag-a2a via A2A
- `src/corpus/` — Shared corpus loading and synthetic Q&A generation
- `src/server/` — HTTP server + dashboard
- `corpus/` — Raw test documents (4 categories: technical, narrative, multi-doc, evolving)
- `wiki/` — Compiled wiki output (gitignored except structure)
- `results/` — Benchmark run outputs
- `paper/` — Research writeup

## Tech Stack
- **Runtime:** Bun (TypeScript, ESM-first)
- **LLM:** OpenAI SDK (gpt-4o-mini for compilation, gpt-4o for judge evaluation)
- **Wiki search:** better-sqlite3 with FTS5
- **Markdown:** gray-matter for YAML frontmatter parsing
- **A2A:** JSON-RPC 2.0 (both wiki-agent and rag-a2a)
- **Testing:** Bun test framework

## Conventions
- All source files are TypeScript (.ts), ESM imports
- Use `pino` for structured logging
- Environment-based config via `src/config.ts`
- Mock providers for all external services (OpenAI, rag-a2a) — zero API keys for tests
- Wiki pages use YAML frontmatter + [[wikilinks]] (Obsidian-compatible)
- Every module exports types + implementation + factory function

## Wiki Page Schema
```yaml
---
title: "Page Title"
type: source | entity | concept | synthesis
tags: []
sources: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

Content with [[WikiLinks]] for cross-references.
```

## Directory Layout for Wiki
```
wiki/
├── index.md          # Master catalog of all pages
├── overview.md       # High-level summary of the knowledge base
├── sources/          # One summary page per ingested source
├── entities/         # People, orgs, projects (auto-created)
├── concepts/         # Ideas, frameworks, patterns (auto-created)
└── syntheses/        # Query answers filed back as pages
```

## Testing
- Unit tests in `tests/unit/` — test every module with mocks
- E2E tests in `tests/e2e/` — full pipeline tests
- Run: `bun test` (all) or `bun test tests/unit` (unit only)
- Mock providers: MockLLM (deterministic), MockRAGClient (stub A2A)

## Research Context
Research files are in C:\Users\aviraldua\temp\research-*.md:
- research-rag-limitations.md — Why RAG fails (enterprise failure modes, academic criticism)
- research-knowledge-compilation.md — Karpathy method implementation details
- research-eval-frameworks.md — RAGAS, LLM-as-Judge, benchmark methodology
- research-corpus-design.md — Datasets, question design, experimental protocol
- research-competing-projects.md — Landscape analysis, differentiation opportunities
