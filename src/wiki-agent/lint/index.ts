/**
 * Barrel export for lint module.
 */

export { lintStructural, lintSemantic, lintStalePages, runLint } from './engine.ts';
export type { LintIssue, LintResult, LintOptions } from './engine.ts';
