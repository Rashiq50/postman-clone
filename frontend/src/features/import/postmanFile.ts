import { IMPORT_MAX_BYTES } from '@raven/contracts'

/**
 * Reading and recognising a picked file — **pure functions, no components**.
 *
 * ⚠️ The split from `ImportDialog.tsx` is the `responseFile.ts` split and it is
 * not taste: a module that exports both components and plain functions breaks
 * fast refresh for the whole file, and `oxlint`'s `only-export-components` is
 * the rule that catches it. The frontend lint is clean and stays clean.
 */

export type ImportKind = 'collection' | 'environment'

/**
 * Which of the two things the user picked.
 *
 * ⚠️ Deliberately **shallow and permissive** — it decides which endpoint to
 * post to, nothing more. The real verdict is the server's DTO constraint, which
 * is the only place that can be authoritative about a Postman schema version.
 * Duplicating that check here would produce two answers that drift, and the one
 * on this side would be the one that refuses a file the server would have
 * accepted.
 *
 * The order matters: a collection is identified by `info` + `item`, an
 * environment by `values`. `_postman_variable_scope` catches a globals export,
 * which has no `name` and would otherwise look like nothing at all.
 */
export function detectImportKind(json: unknown): ImportKind | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return null
  }
  const document = json as Record<string, unknown>

  const info = document.info
  if (
    typeof info === 'object' &&
    info !== null &&
    'schema' in info &&
    Array.isArray(document.item)
  ) {
    return 'collection'
  }

  if (Array.isArray(document.values) || '_postman_variable_scope' in document) {
    return 'environment'
  }

  return null
}

export interface ParsedImportFile {
  kind: ImportKind
  data: unknown
  fileName: string
}

/** A failure a person can act on, rather than a raw `SyntaxError`. */
export class ImportFileError extends Error {}

/**
 * Reads a picked file into `{ kind, data }`.
 *
 * ⚠️ The size is checked **before** the file is read, against the same
 * `IMPORT_MAX_BYTES` the server's body parser enforces. That is not a duplicate
 * of the server check but a different job: it fails a 200 MB pick instantly and
 * locally instead of after a long upload that ends in a 413. The server remains
 * the enforcement.
 */
export async function parseImportFile(file: File): Promise<ParsedImportFile> {
  if (file.size > IMPORT_MAX_BYTES) {
    const limitMb = Math.round(IMPORT_MAX_BYTES / (1024 * 1024))
    throw new ImportFileError(
      `That file is ${Math.round(file.size / (1024 * 1024))} MB. The limit is ${limitMb} MB.`,
    )
  }

  let data: unknown
  try {
    data = JSON.parse(await file.text())
  } catch {
    // The parser's own message ("Unexpected token < in JSON at position 0") is
    // about bytes, not about what the user did wrong.
    throw new ImportFileError(
      `"${file.name}" is not valid JSON. Export from Postman as a Collection v2.1 or Environment file.`,
    )
  }

  const kind = detectImportKind(data)
  if (!kind) {
    throw new ImportFileError(
      `"${file.name}" does not look like a Postman collection or environment export.`,
    )
  }

  return { kind, data, fileName: file.name }
}
