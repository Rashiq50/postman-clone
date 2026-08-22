/**
 * Sending a stored request, and the record of having sent it.
 *
 * ⚠️ **A failed upstream request is not an API error of ours.**
 * `POST /requests/:id/send` answers **200** whether the target returned 200,
 * returned 500, refused the connection, or was blocked before a socket opened.
 * The outcome is carried inside the body, in a union discriminated on
 * `outcome`. Our error envelope (`{ error: { code, … } }`) is reserved strictly
 * for *our* failures: a malformed DTO, a request we will not show you, a rate
 * limit, an unexpected throw.
 *
 * Collapsing upstream failures into the envelope would make a 500 from the
 * target indistinguishable from our own backend falling over, would force the
 * client to branch on our HTTP status, and would mean the response pane could
 * never show a 4xx body — which is most of what a person presses Send to look
 * at.
 */

import type { HttpMethod, KeyValueEntry, RequestAuth, RequestBody } from './request';

export const SEND_FAILURE_KINDS = [
  'invalid-url', // after interpolation: unparseable, or an unsupported scheme
  'blocked-address', // the SSRF policy refused a resolved address
  'dns', // NXDOMAIN, SERVFAIL
  'connect', // ECONNREFUSED, EHOSTUNREACH, connect timeout
  'tls', // certificate / handshake
  'timeout', // the total deadline elapsed
  'too-many-redirects',
  'invalid-header', // CR/LF or a forbidden header, after interpolation
  'aborted', // the socket died mid-body
  'unknown',
] as const;

export type SendFailureKind = (typeof SEND_FAILURE_KINDS)[number];

export const SEND_WARNING_KINDS = [
  'unresolved-variable',
  'header-overridden-by-auth',
  'body-on-bodyless-method',
  'body-truncated',
  'stored-body-truncated',
  'auth-stripped-on-cross-origin-redirect',
  // The import slice: modes and schemes we store faithfully but cannot send.
  'unsupported-body-mode',
  'unsupported-auth-type',
  'invalid-graphql-variables',
] as const;

export type SendWarningKind = (typeof SEND_WARNING_KINDS)[number];

export interface SendWarning {
  kind: SendWarningKind;
  /** Human-readable; the client renders it verbatim. Branch on `kind`. */
  message: string;
}

/**
 * ⚠️ Ordered pairs, not a map and not `KeyValueEntry`: `set-cookie` repeats, so
 * a map would silently drop all but one, and an `enabled` flag is meaningless
 * on a response.
 */
export interface ResponseHeader {
  name: string;
  value: string;
}

export type ResponseBodyPayload =
  | { encoding: 'text'; text: string }
  | { encoding: 'base64'; base64: string }
  | { encoding: 'empty' };

/**
 * ⚠️ The phase fields describe the **final hop only**. A `tlsMs` summed across
 * five redirects would mean nothing. `totalMs` spans everything.
 */
export interface SendTiming {
  totalMs: number;
  /** Null for a literal IP — no lookup happened. */
  dnsMs: number | null;
  connectMs: number | null;
  /** Null for plain http. */
  tlsMs: number | null;
  firstByteMs: number | null;
}

export interface RedirectHop {
  status: number;
  from: string;
  to: string;
}

export interface SendResponse {
  outcome: 'response';
  status: number;
  statusText: string;
  headers: ResponseHeader[];
  body: ResponseBodyPayload;
  bodyBytes: number;
  bodyTruncated: boolean;
}

export interface SendFailure {
  outcome: 'failure';
  kind: SendFailureKind;
  /** Safe for a user. Never a stack, never a raw errno or driver dump. */
  message: string;
}

export interface SendResult {
  /** Null only when the history insert failed. The send still happened. */
  executionId: string | null;
  requestId: string;
  /** The final URL after interpolation and redirects, secret-redacted. */
  url: string;
  method: HttpMethod;
  environmentId: string | null;
  usedDraft: boolean;
  redirects: RedirectHop[];
  warnings: SendWarning[];
  timing: SendTiming;
  startedAt: string;
  result: SendResponse | SendFailure;
}

/**
 * The editable subset a send may carry instead of the saved row.
 *
 * The editor has no autosave, so without this Send would fire the *last saved*
 * request while the user looks at their edits. Forcing a save on Send instead
 * would silently write to disk on what reads as a read-only action. So the
 * client posts its dirty draft, the server merges `{ ...stored, ...draft }`,
 * and records `usedDraft` — ⚠️ otherwise the history row silently claims
 * something was sent that was never saved.
 *
 * ⚠️ Deliberately carries no `collectionId` or `folderId`: a draft cannot
 * reparent anything, and the stored row remains the authorization anchor.
 */
export interface SendDraft {
  method?: HttpMethod;
  url?: string;
  headers?: KeyValueEntry[];
  queryParams?: KeyValueEntry[];
  body?: RequestBody;
  auth?: RequestAuth;
}

export interface SendRequestInput {
  /** Omitted → the caller's active environment. `null` → none. */
  environmentId?: string | null;
  /** Omitted → the saved row is sent. */
  draft?: SendDraft;
}

/** History list row — no body, so the list stays cheap. */
export interface RequestExecutionSummary {
  id: string;
  requestId: string;
  method: HttpMethod;
  url: string;
  outcome: 'response' | 'failure';
  status: number | null;
  statusText: string | null;
  failureKind: SendFailureKind | null;
  durationMs: number;
  bodyBytes: number | null;
  usedDraft: boolean;
  createdAt: string;
}

/** One stored run, in full. Its body is capped separately from the live one. */
export interface RequestExecution extends RequestExecutionSummary {
  environmentId: string | null;
  headers: ResponseHeader[];
  body: ResponseBodyPayload;
  bodyTruncated: boolean;
  redirects: RedirectHop[];
  warnings: SendWarning[];
  timing: SendTiming;
  failureMessage: string | null;
}
