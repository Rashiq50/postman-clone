/**
 * Importing a Postman export.
 *
 * ⚠️ **The Postman source shapes are deliberately absent from this file.** They
 * live in `backend/src/import/postman-types.ts` and go no further: nothing on
 * the client parses a Postman document, so putting those types here would
 * publish a vocabulary only one module speaks and invite a second parser to
 * grow on the other side of the wire. What crosses the boundary is `unknown` —
 * the file's bytes, parsed to JSON by the browser only so it can be posted as a
 * body, and validated for real by the DTO constraint on arrival.
 *
 * ⚠️ **Warnings are data, not errors.** An import that drops a folder's auth
 * and coerces one unknown method still succeeded, and answering `400` because
 * part of a 900-request export was lossy would leave the user with nothing.
 * There is therefore **no new `ApiErrorCode`** for anything in here — the same
 * call the send path makes about an upstream 500, for the same reason.
 */

import type { Collection } from './collection';
import type { Environment } from './environment';

/**
 * The whole-document cap, enforced twice: the client checks `File.size` before
 * reading (so a 200 MB pick fails instantly and locally) and the body parser
 * enforces it for real. Nest's own default is 100 kB, which real exports pass
 * routinely — `configure-app.ts` raises it to exactly this number.
 */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Folders + requests, counted recursively before anything is mapped. The byte
 * cap alone does not bound the work: a small file can describe a deep tree, and
 * the insert path builds one statement per depth level.
 */
export const IMPORT_MAX_ITEMS = 5000;

export const IMPORT_WARNING_KINDS = [
  /** A scheme stored as `{ type: 'unsupported' }`, or one we did not know. */
  'unsupported-auth',
  /** A body mode stored but not sendable, or one we did not know. */
  'unsupported-body',
  /** A method outside `HTTP_METHODS`; coerced to GET. */
  'unsupported-method',
  /** A folder's own auth, dropped rather than copied onto every request. */
  'folder-auth-dropped',
  /** A folder's `variable[]`, folded up into the collection's. */
  'folder-variables-merged',
  /** Two scopes defined the same variable key; the first seen won. */
  'variable-conflict',
  /** A collection- or folder-level `event[]` script, dropped. */
  'collection-script-dropped',
  /** `:id` style path variables, left literal in the URL. */
  'path-variables',
  /** Saved example responses, dropped. One aggregate warning with a count. */
  'examples-dropped',
  /** A `type: 'file'` form-data row or a binary body — a path, not a file. */
  'file-placeholder',
  /** A Postman *globals* export, imported as an ordinary environment. */
  'globals-as-environment',
] as const;

export type ImportWarningKind = (typeof IMPORT_WARNING_KINDS)[number];

export interface ImportWarning {
  kind: ImportWarningKind;
  /**
   * Where in the source document, as a `/`-joined chain of the names the user
   * will recognise (`"My API / Auth / Login"`). Not a JSON pointer: the person
   * reading it is looking at Postman's sidebar, not at the file.
   */
  path: string;
  /** Human-readable; the client renders it verbatim. Branch on `kind`. */
  message: string;
}

/** ⚠️ `data` is the raw Postman document, opaque on the wire. See the note above. */
export interface ImportCollectionInput {
  workspaceId: string;
  data: unknown;
}

export interface ImportCollectionResult {
  collection: Collection;
  folderCount: number;
  requestCount: number;
  warnings: ImportWarning[];
}

export interface ImportEnvironmentInput {
  workspaceId: string;
  data: unknown;
}

export interface ImportEnvironmentResult {
  environment: Environment;
  warnings: ImportWarning[];
}
