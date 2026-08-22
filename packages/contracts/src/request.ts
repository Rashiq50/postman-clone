/**
 * The saved HTTP request — the thing this app exists to store.
 *
 * ⚠️ The wire type is `ApiRequest`, not `Request`. `Request` is both a DOM
 * global and an `@types/express` type; an export by that name shadows both and
 * the resulting compile errors point at files that have nothing to do with the
 * mistake. The entity is `RequestEntity` and the table is `requests`.
 */

export const HttpMethod = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DELETE',
  HEAD: 'HEAD',
  OPTIONS: 'OPTIONS',
} as const;

export type HttpMethod = (typeof HttpMethod)[keyof typeof HttpMethod];

export const HTTP_METHODS: readonly HttpMethod[] = Object.values(HttpMethod);

export const REQUEST_NAME_MAX_LENGTH = 200;

/** One row of the headers or query-params editor. Disabled rows round-trip. */
export interface KeyValueEntry {
  key: string;
  value: string;
  enabled: boolean;
}

export const REQUEST_BODY_MODES = [
  'none',
  'raw',
  'json',
  'form-urlencoded',
  'xml',
  'graphql',
  'form-data',
  'binary',
] as const;

export type RequestBodyMode = (typeof REQUEST_BODY_MODES)[number];

/**
 * One row of the multipart form-data editor.
 *
 * ⚠️ A `type: 'file'` row is a **placeholder**, not an upload: `value` holds
 * the path Postman recorded in `src`, and nothing reads a file off disk. The
 * send path refuses a `form-data` body outright and warns. The row exists so an
 * imported collection round-trips faithfully rather than losing its shape, and
 * so the file-upload slice has something to grow into.
 */
export interface FormDataEntry {
  key: string;
  value: string;
  enabled: boolean;
  type: 'text' | 'file';
}

export const FORM_DATA_ENTRY_TYPES = ['text', 'file'] as const;

/**
 * Discriminated on `mode`. Stored whole as `jsonb`: nothing filters or sorts
 * on a body, so splitting it into columns would buy nothing.
 *
 * ⚠️ `xml`, `graphql`, `form-data` and `binary` arrived with Postman import,
 * on the "map now, implement later" rule: a mode we can *store* faithfully is
 * a collection that survives a round trip, whereas collapsing them into `raw`
 * would silently destroy the distinction on first save. Send implements `xml`
 * and `graphql` (both are text serialization); `form-data` and `binary` send
 * no body and warn, because both need the file-upload storage question
 * answered first.
 */
export type RequestBody =
  | { mode: 'none' }
  | { mode: 'raw'; text: string }
  | { mode: 'json'; text: string }
  | { mode: 'form-urlencoded'; entries: KeyValueEntry[] }
  | { mode: 'xml'; text: string }
  /** `variables` is raw JSON *text*, which is how Postman stores it. */
  | { mode: 'graphql'; query: string; variables: string }
  | { mode: 'form-data'; entries: FormDataEntry[] }
  /** The path Postman recorded. Display-only — see `FormDataEntry`. */
  | { mode: 'binary'; src: string };

/**
 * The two script slots that run around a send, stored whole as `jsonb` for the
 * same reason as `body`: nothing filters or sorts on a script.
 *
 * Both fields are **required and default to the empty string**, not optional —
 * an absent key and an empty script mean the same thing to every reader, and
 * allowing both spellings would make every consumer write
 * `scripts?.preRequest ?? ''`. The column default is the same empty pair.
 *
 * ⚠️ Nothing executes these yet. Sending a request is deliberately out of scope
 * for this slice (see the README), so this is storage only — the strings
 * round-trip and are never evaluated. When execution lands, the sandbox is the
 * security surface, not this type.
 */
export interface RequestScripts {
  /** Runs before the request is sent. */
  preRequest: string;
  /** Runs after the response arrives. */
  postRequest: string;
}

export const REQUEST_AUTH_TYPES = [
  'inherit',
  'none',
  'bearer',
  'basic',
  'apiKey',
  'unsupported',
] as const;

export type RequestAuthType = (typeof REQUEST_AUTH_TYPES)[number];

/**
 * Postman auth schemes this app understands well enough to *store* but not to
 * *send*. They all collapse into the single `unsupported` variant below rather
 * than becoming nine pickable entries in the auth dropdown: nothing here can be
 * authored, only imported, and a `Select` offering "awsv4" as a choice that
 * then sends nothing is a worse lie than no choice at all.
 */
export const POSTMAN_UNSUPPORTED_AUTH_SCHEMES = [
  'oauth1',
  'oauth2',
  'digest',
  'awsv4',
  'ntlm',
  'hawk',
  'edgegrid',
  'jwt',
  'asap',
] as const;

export type PostmanAuthScheme =
  (typeof POSTMAN_UNSUPPORTED_AUTH_SCHEMES)[number];

/**
 * ⚠️ Secrets here are stored and returned in plaintext — this is what Postman
 * does and an accepted trade-off for this slice. The fix is a write-only
 * secrets table with envelope encryption; see the README.
 */
export type RequestAuth =
  | { type: 'inherit' }
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'apiKey'; key: string; value: string; in: 'header' | 'query' }
  /**
   * An imported scheme we store verbatim and never send. `params` is whatever
   * Postman recorded for it, flattened to rows; the editor shows it read-only
   * and the send path warns.
   */
  | {
      type: 'unsupported';
      scheme: PostmanAuthScheme;
      params: KeyValueEntry[];
    };

export interface ApiRequest {
  id: string;
  collectionId: string;
  /** NULL means the request sits at the collection root. */
  folderId: string | null;
  name: string;
  method: HttpMethod;
  /** May be empty: a request exists before it has a URL. */
  url: string;
  description: string | null;
  headers: KeyValueEntry[];
  queryParams: KeyValueEntry[];
  body: RequestBody;
  auth: RequestAuth;
  scripts: RequestScripts;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateApiRequestInput {
  collectionId: string;
  folderId?: string | null;
  name: string;
  method?: HttpMethod;
  url?: string;
  description?: string | null;
  headers?: KeyValueEntry[];
  queryParams?: KeyValueEntry[];
  body?: RequestBody;
  auth?: RequestAuth;
  scripts?: RequestScripts;
}

export type UpdateApiRequestInput = Partial<
  Omit<CreateApiRequestInput, 'collectionId' | 'folderId'>
>;

/** `folderId` null moves the request to the collection root. */
export interface MoveApiRequestInput {
  folderId: string | null;
  index?: number;
}
