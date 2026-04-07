# Agent Instructions — wiki-vs-rag

## Identity
Head-to-head benchmark: RAG vs Karpathy-style LLM Wiki Knowledge Compilation.
Two systems answer the same questions over the same corpus. Metrics determine which wins.
This project implements Karpathy's exact LLM Knowledge Base methodology for the wiki-agent side.

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

## Wiki Conventions (Karpathy Methodology)

### YAML Frontmatter Schema
```yaml
---
title: "Page Title"
type: source | entity | concept | synthesis
tags: [relevant, tags]
sources: [path/to/source.md]
source_count: 1
status: draft | reviewed | needs_update
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

### Source Citations
Inline citations use the format: `[Source: filename.md]`
Every factual claim should be traceable to a source document.

### Contradiction Flags
When new information contradicts existing wiki content:
```
> CONTRADICTION: [existing claim] vs [new claim] from [Source: filename.md]
```

### Wikilinks
Use `[[Page Title]]` for cross-references (Obsidian-compatible).
Ingest should create rich cross-linking — aim for many cross-page links per source.

## Index & Log

### wiki/index.md
Master catalog listing every page with a one-line description, organized by category
(sources, entities, concepts, syntheses). Auto-generated after each ingest.

### wiki/log.md
Append-only chronological log of all wiki operations:
```
## [YYYY-MM-DD] INGEST | Ingested "source-title.md" — created 3 pages, updated 5
## [YYYY-MM-DD] QUERY | "What is X?" — answered, filed as syntheses/answer-x.md
## [YYYY-MM-DD] LINT | 47 pages checked, 3 issues found, score 94%
```

## Directory Layout for Wiki
```
wiki/
├── index.md          # Master catalog of all pages (auto-generated)
├── overview.md       # High-level summary of the knowledge base
├── log.md            # Append-only chronological activity log
├── sources/          # One summary page per ingested source
├── entities/         # People, orgs, projects (auto-created)
├── concepts/         # Ideas, frameworks, patterns (auto-created)
└── syntheses/        # Query answers filed back as pages (compounding loop)
```

## Workflows

### INGEST Workflow
1. Read source document from corpus/
2. LLM compiles into wiki page with YAML frontmatter + [[wikilinks]] + [Source: ...] citations
3. Extract entities and concepts as sub-pages
4. Index all pages in FTS5
5. Write pages to disk
6. Generate/update index.md and overview.md
7. Append to log.md

### QUERY Workflow
1. Search FTS5 index for relevant pages
2. Load full page content for top matches
3. LLM synthesizes answer with [[citations]]
4. Optionally file answer back as a synthesis page (compounding loop)

### LINT Workflow
1. Structural: broken wikilinks, missing frontmatter, orphan pages, stale pages
2. Uncited claims: pages without source attribution
3. Missing cross-references: related pages that should link to each other
4. Semantic (LLM): contradictions, knowledge gaps, quality issues

### EXPLORE Workflow
Use query to explore the knowledge base interactively. File insights back as syntheses.

### BRIEF Workflow
Generate a concise summary of the knowledge base state, recent changes, and outstanding issues.

## Focus Areas
- Faithful implementation of Karpathy's methodology for fair benchmarking
- Source traceability: every claim → source document → corpus file
- Self-healing: lint catches drift, contradictions, and gaps
- Compounding: query answers feed back into the wiki

## Known Limitations (per Karpathy)
- Context ceiling: ~400K words practical limit for wiki size
- Error compounding: LLM compilation errors propagate across pages
- Hallucination: compiled pages may contain LLM-fabricated claims
- Cost: $2-5 per source document compilation
- No enterprise scale: single-user, single-model architecture
- Single-model blind spots: one LLM's biases shape the entire wiki

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
