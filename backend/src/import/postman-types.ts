/**
 * The shapes a Postman v2.x export can take — **backend-internal, deliberately
 * not in `packages/contracts`**.
 *
 * Nothing on the client parses a Postman document: the browser reads the file,
 * `JSON.parse`s it so it can be posted as a body, and the server owns every
 * decision after that. Publishing these types in contracts would advertise a
 * vocabulary only this module speaks and invite a second parser to grow on the
 * other side of the wire, which is exactly the drift the contracts package
 * exists to prevent.
 *
 * ⚠️ **Every field is optional and every union is wide, on purpose.** These
 * describe a file someone else's tool wrote, possibly years ago, possibly
 * hand-edited. They are a *reading aid for the mapper*, not a validation
 * schema — the DTO constraint checks the handful of things that must be true
 * (schema URL, `info.name`, `item` is an array, item count) and the mapper is
 * total and defensive about everything else. A required field here would be a
 * claim about a stranger's file that we cannot enforce and do not need.
 *
 * The v2.0/v2.1 differences that actually matter, all handled by helpers in
 * the mapper rather than by two type trees:
 *
 * - `url` is a bare string in v2.0 and usually an object in v2.1 (both spellings
 *   are legal in both versions in practice);
 * - `auth.<scheme>` is an **object** of params in v2.0 and an **array** of
 *   `{ key, value }` in v2.1;
 * - `header` may be a raw `\n`-delimited string rather than an array.
 */

/** A description is a string or `{ content }`, in both versions. */
export type PostmanDescription = string | { content?: unknown } | null;

export interface PostmanVariable {
  key?: unknown;
  value?: unknown;
  disabled?: unknown;
  type?: unknown;
}

export interface PostmanHeader {
  key?: unknown;
  value?: unknown;
  disabled?: unknown;
  description?: PostmanDescription;
}

export interface PostmanQueryParam {
  key?: unknown;
  value?: unknown;
  disabled?: unknown;
}

export interface PostmanUrlObject {
  raw?: unknown;
  protocol?: unknown;
  host?: unknown;
  path?: unknown;
  port?: unknown;
  query?: unknown;
  variable?: unknown;
  hash?: unknown;
}

export type PostmanUrl = string | PostmanUrlObject;

export interface PostmanFormParam {
  key?: unknown;
  value?: unknown;
  src?: unknown;
  type?: unknown;
  disabled?: unknown;
}

export interface PostmanBody {
  mode?: unknown;
  raw?: unknown;
  urlencoded?: unknown;
  formdata?: unknown;
  graphql?: unknown;
  file?: unknown;
  options?: unknown;
  disabled?: unknown;
}

export interface PostmanAuth {
  type?: unknown;
  /** Indexed by scheme: `{ bearer: [...] }` or `{ bearer: { token: '…' } }`. */
  [scheme: string]: unknown;
}

export interface PostmanEvent {
  listen?: unknown;
  script?: unknown;
  disabled?: unknown;
}

export interface PostmanRequest {
  method?: unknown;
  url?: unknown;
  header?: unknown;
  body?: unknown;
  auth?: unknown;
  description?: PostmanDescription;
}

/**
 * One node. A **request item** has `request`; an **item-group** (folder) has
 * `item`. Postman allows both keys to be absent, which the mapper reads as a
 * request item with nothing in it rather than as an error.
 */
export interface PostmanItem {
  name?: unknown;
  item?: unknown;
  request?: unknown;
  response?: unknown;
  event?: unknown;
  variable?: unknown;
  auth?: unknown;
  description?: PostmanDescription;
}

export interface PostmanInfo {
  name?: unknown;
  schema?: unknown;
  description?: PostmanDescription;
}

export interface PostmanCollection {
  info?: unknown;
  item?: unknown;
  variable?: unknown;
  auth?: unknown;
  event?: unknown;
}

export interface PostmanEnvironment {
  name?: unknown;
  values?: unknown;
  _postman_variable_scope?: unknown;
}

/**
 * The accepted `info.schema` values. v2.0 and v2.1 differ only in the ways
 * listed at the top of this file, all of which the mapper normalizes; anything
 * else — v1, a Postman *dump*, an OpenAPI document — is a 400 rather than a
 * best-effort parse that silently produces an empty collection.
 */
export const SUPPORTED_SCHEMA_PATTERN =
  /^https?:\/\/schema\.(get)?postman\.com\/(json\/)?collection\/v2\.[01]\.0\/?(collection\.json)?$/;
