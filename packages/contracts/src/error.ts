/**
 * Machine-readable error codes.
 *
 * Clients branch on `code`, never on `message` — messages are for humans and
 * are free to be reworded or localised without it being a breaking change.
 * Adding a code is additive; renaming or removing one is not.
 */
export const ApiErrorCode = {
  /** Request body or query failed validation. Carries `details`. */
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  /** Malformed request that is not field-level validation (bad uuid, bad JSON). */
  BAD_REQUEST: 'BAD_REQUEST',
  /** No credentials, or credentials that are not valid. */
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  /** Authenticated, but not allowed to do this. */
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  /** State conflict: duplicate key, version mismatch, replayed idempotency key. */
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  /** Unexpected server fault. Never carries internal detail. */
  INTERNAL: 'INTERNAL',

  EMAIL_TAKEN: 'EMAIL_TAKEN',
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

/** One field-level problem. `field` is a dotted path, e.g. `address.postcode`. */
export interface ApiErrorDetail {
  field: string;
  message: string;
}

export interface ApiErrorBody {
  code: ApiErrorCode;
  /** Safe to show a user. Never contains internal or database detail. */
  message: string;
  /** Present for VALIDATION_FAILED; absent otherwise. */
  details?: ApiErrorDetail[];
  /** Echoed in the `x-request-id` response header. Quote it in bug reports. */
  requestId: string;
  /** ISO 8601. */
  timestamp: string;
  path: string;
}

/**
 * Every non-2xx response from the API has this shape.
 *
 * The single `error` key is what makes a response unambiguous: a body either
 * has it and is a failure, or does not and is a success. That is what
 * `isApiError` checks, and why the envelope is wrapped rather than flat.
 */
export interface ApiError {
  error: ApiErrorBody;
}

export function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = (value as { error?: unknown }).error;
  if (typeof candidate !== 'object' || candidate === null) return false;
  const body = candidate as Partial<ApiErrorBody>;
  return typeof body.code === 'string' && typeof body.message === 'string';
}
