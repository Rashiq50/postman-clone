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
] as const;

export type RequestBodyMode = (typeof REQUEST_BODY_MODES)[number];

/**
 * Discriminated on `mode`. Stored whole as `jsonb`: nothing filters or sorts
 * on a body, so splitting it into columns would buy nothing.
 */
export type RequestBody =
  | { mode: 'none' }
  | { mode: 'raw'; text: string }
  | { mode: 'json'; text: string }
  | { mode: 'form-urlencoded'; entries: KeyValueEntry[] };

export const REQUEST_AUTH_TYPES = [
  'inherit',
  'none',
  'bearer',
  'basic',
  'apiKey',
] as const;

export type RequestAuthType = (typeof REQUEST_AUTH_TYPES)[number];

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
  | { type: 'apiKey'; key: string; value: string; in: 'header' | 'query' };

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
}

export type UpdateApiRequestInput = Partial<
  Omit<CreateApiRequestInput, 'collectionId' | 'folderId'>
>;

/** `folderId` null moves the request to the collection root. */
export interface MoveApiRequestInput {
  folderId: string | null;
  index?: number;
}
