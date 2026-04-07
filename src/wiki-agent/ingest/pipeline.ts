/**
 * Ingest pipeline — converts raw corpus documents into compiled wiki pages.
 *
 * Takes CorpusDocuments, sends them through the LLM compiler, and stores
 * the resulting WikiPages in the FTS5 storage and as files on disk.
 *
 * Pipeline stages:
 * 1. Load: CorpusDocument from disk
 * 2. Extract: LLM extracts entities, concepts, and key facts
 * 3. Compile: LLM compiles into wiki page with YAML frontmatter + [[wikilinks]]
 * 4. Store: Index in FTS5 and write to disk
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type {
  CorpusDocument,
  WikiPage,
  WikiPageType,
  LLMProvider,
  ChatMessage,
} from '../../types.ts';
import { parseWikiPage, serializeWikiPage, extractWikilinks } from '../wiki/page.ts';
import type { WikiFTS5Storage } from '../wiki/fts5-storage.ts';
import { createLogger } from '../../logger.ts';

const log = createLogger('ingest-pipeline');

/** Options for the ingest pipeline. */
export interface IngestOptions {
  /** Directory to write compiled wiki pages */
  wikiDir: string;
  /** Whether to write files to disk (false for testing) */
  writeToDisk?: boolean;
  /** Model to use for compilation */
  model?: string;
  /** Whether to extract and compile entity/concept pages too */
  extractSubPages?: boolean;
}

/** Result of ingesting a single document. */
export interface IngestResult {
  /** Source document ID */
  documentId: string;
  /** Whether compilation succeeded */
  success: boolean;
  /** The compiled wiki page (if successful) */
  page?: WikiPage;
  /** Additional entity/concept pages generated */
  subPages?: WikiPage[];
  /** Error message (if failed) */
  error?: string;
}

/**
 * Build the compilation prompt for a corpus document.
 */
function buildCompilePrompt(doc: CorpusDocument): ChatMessage[] {
  const today = new Date().toISOString().split('T')[0];
  return [
    {
      role: 'system',
      content: `You are a wiki compiler following the Karpathy LLM Knowledge Base methodology.
Convert the following source document into a well-structured wiki page with YAML frontmatter.

Requirements:
- Use [[WikiLinks]] to reference related concepts, entities, and other pages (Obsidian-compatible format)
- Extract and link to key entities (people, organizations, projects, technologies)
- Extract and link to key concepts (ideas, frameworks, patterns, methodologies)
- Produce clear, well-organized content with headings
- Include inline source citations using [Source: ${doc.relativePath}] format for key claims
- Flag contradictions with existing knowledge using the format:
  > CONTRADICTION: [existing claim] vs [new claim] from [Source: ${doc.relativePath}]
- Each page should be self-contained but richly cross-linked

Follow this YAML frontmatter schema exactly:
---
title: "Page Title"
type: source
tags: [relevant, tags]
sources: [${doc.relativePath}]
source_count: 1
status: draft
created: ${today}
updated: ${today}
---

Content with [[WikiLinks]] for cross-references and [Source: filename.md] citations.`,
    },
    {
      role: 'user',
      content: `Compile this document into a wiki page:\n\nTitle: ${doc.title}\nCategory: ${doc.category}\nPath: ${doc.relativePath}\n\n${doc.content}`,
    },
  ];
}

/**
 * Build the entity/concept extraction prompt.
 */
function buildExtractionPrompt(doc: CorpusDocument): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `You are a knowledge extractor. Analyze the following document and extract key entities and concepts. Return a JSON object with this structure:
{
  "entities": [
    { "name": "Entity Name", "type": "person|organization|project|technology", "description": "Brief description" }
  ],
  "concepts": [
    { "name": "Concept Name", "description": "Brief description of the concept" }
  ]
}

Only include genuinely important entities and concepts, not minor mentions.`,
    },
    {
      role: 'user',
      content: `Extract entities and concepts from this document:\n\nTitle: ${doc.title}\n\n${doc.content}`,
    },
  ];
}

/** Sanitize a title into a valid filename slug. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'untitled';
}

/**
 * Create a wiki page for an extracted entity or concept.
 */
function createSubPage(
  name: string,
  description: string,
  type: WikiPageType,
  sourceDoc: CorpusDocument,
): WikiPage {
  const today = new Date().toISOString().split('T')[0];
  const dir = type === 'entity' ? 'entities' : 'concepts';
  const slug = slugify(name);

  return {
    title: name,
    type,
    tags: [type, sourceDoc.category],
    sources: [sourceDoc.relativePath],
    content: `# ${name}\n\n${description}\n\nExtracted from [[${sourceDoc.title}]].`,
    wikilinks: [sourceDoc.title],
    created: today,
    updated: today,
    filePath: `${dir}/${slug}.md`,
  };
}

/**
 * Ingest a single corpus document into a wiki page.
 */
export async function ingestDocument(
  doc: CorpusDocument,
  llm: LLMProvider,
  storage: WikiFTS5Storage,
  options: IngestOptions,
): Promise<IngestResult> {
  log.info({ docId: doc.id, title: doc.title }, 'Ingesting document');

  try {
    // Stage 1: Compile source document into wiki page
    const messages = buildCompilePrompt(doc);
    const response = await llm.complete(messages, { model: options.model });
    const page = parseWikiPage(response.content, `sources/${doc.id}.md`);

    if (!page) {
      return {
        documentId: doc.id,
        success: false,
        error: 'Failed to parse LLM response into wiki page',
      };
    }

    // Ensure source is tracked
    if (!page.sources.includes(doc.relativePath)) {
      page.sources.push(doc.relativePath);
    }

    // Set Karpathy metadata fields
    page.source_count = page.sources.length;
    page.status = 'draft';

    // Index in FTS5
    storage.upsertPage(page);

    // Write to disk if requested
    if (options.writeToDisk !== false) {
      const outPath = join(options.wikiDir, `sources/${doc.id}.md`);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, serializeWikiPage(page), 'utf-8');
      log.debug({ outPath }, 'Wiki page written to disk');
    }

    // Stage 2: Extract entities and concepts (optional)
    const subPages: WikiPage[] = [];
    if (options.extractSubPages) {
      const extractionMessages = buildExtractionPrompt(doc);
      const extractionResponse = await llm.complete(extractionMessages, {
        model: options.model,
        responseFormat: 'json',
      });

      try {
        const extracted = JSON.parse(extractionResponse.content);

        if (Array.isArray(extracted.entities)) {
          for (const entity of extracted.entities) {
            if (entity.name && entity.description) {
              const entityPage = createSubPage(entity.name, entity.description, 'entity', doc);
              storage.upsertPage(entityPage);
              subPages.push(entityPage);

              if (options.writeToDisk !== false) {
                const outPath = join(options.wikiDir, entityPage.filePath!);
                await mkdir(dirname(outPath), { recursive: true });
                await writeFile(outPath, serializeWikiPage(entityPage), 'utf-8');
              }
            }
          }
        }

        if (Array.isArray(extracted.concepts)) {
          for (const concept of extracted.concepts) {
            if (concept.name && concept.description) {
              const conceptPage = createSubPage(concept.name, concept.description, 'concept', doc);
              storage.upsertPage(conceptPage);
              subPages.push(conceptPage);

              if (options.writeToDisk !== false) {
                const outPath = join(options.wikiDir, conceptPage.filePath!);
                await mkdir(dirname(outPath), { recursive: true });
                await writeFile(outPath, serializeWikiPage(conceptPage), 'utf-8');
              }
            }
          }
        }
      } catch {
        log.warn({ docId: doc.id }, 'Failed to parse entity/concept extraction response');
      }
    }

    return { documentId: doc.id, success: true, page, subPages };
  } catch (err: any) {
    log.error({ docId: doc.id, err }, 'Ingest failed');
    return {
      documentId: doc.id,
      success: false,
      error: err.message ?? String(err),
    };
  }
}

/**
 * Run the full ingest pipeline on a set of corpus documents.
 *
 * @param documents - Array of corpus documents to ingest
 * @param llm - LLM provider (real or mock)
 * @param storage - FTS5 storage instance
 * @param options - Ingest configuration
 * @returns Array of results, one per document
 */
export async function runIngestPipeline(
  documents: CorpusDocument[],
  llm: LLMProvider,
  storage: WikiFTS5Storage,
  options: IngestOptions,
): Promise<IngestResult[]> {
  log.info({ docCount: documents.length, wikiDir: options.wikiDir }, 'Starting ingest pipeline');

  const results: IngestResult[] = [];
  for (const doc of documents) {
    const result = await ingestDocument(doc, llm, storage, options);
    results.push(result);
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const subPageCount = results.reduce((sum, r) => sum + (r.subPages?.length ?? 0), 0);

  log.info(
    { succeeded, failed, total: results.length, subPages: subPageCount },
    'Ingest pipeline complete',
  );

  return results;
}
