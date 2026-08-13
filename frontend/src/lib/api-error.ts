import { isApiError, type ApiErrorBody } from '@postman-clone/contracts'
import type { SerializedError } from '@reduxjs/toolkit'
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query'

type QueryError = FetchBaseQueryError | SerializedError | undefined

/**
 * Pulls the API's error body out of whatever RTK Query hands back.
 *
 * Returns null when the failure never reached the API — a dropped connection,
 * a proxy error page, a CORS rejection — because those are not the API
 * speaking and must not be reported as if they were.
 */
export function toApiError(error: QueryError): ApiErrorBody | null {
  if (!error) return null
  if ('data' in error && isApiError(error.data)) return error.data.error
  return null
}

/** A message safe to put in front of a user, whatever went wrong. */
export function errorMessage(error: QueryError, fallback: string): string {
  return toApiError(error)?.message ?? fallback
}

/** Field-level problems, keyed by field, for annotating a form. */
export function fieldErrors(error: QueryError): Record<string, string> {
  const details = toApiError(error)?.details ?? []
  return details.reduce<Record<string, string>>((acc, detail) => {
    acc[detail.field] ??= detail.message
    return acc
  }, {})
}
