import type { ApiRequest, UpdateApiRequestInput } from '@postman-clone/contracts'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { paramsFromUrl, seedUrl } from './urlQuery'

/** The editable subset of a request. Ids and timestamps are not draftable. */
export type RequestDraft = Pick<
  ApiRequest,
  | 'name'
  | 'method'
  | 'url'
  | 'description'
  | 'headers'
  | 'queryParams'
  | 'body'
  | 'auth'
  | 'scripts'
>

function toDraft(request: ApiRequest): RequestDraft {
  // The URL bar and the Params table are kept in sync from here on
  // (see urlQuery.ts), so the seed must already satisfy the invariant: a row
  // stored before the sync existed lives only in the table, and seeding the
  // bare `request.url` would show a URL missing params the send path appends —
  // then the first keystroke in the bar would re-derive the table from it and
  // wipe them. `seedUrl` folds those rows into the URL once; `paramsFromUrl`
  // then makes the table mirror it (a no-op identity for rows saved after the
  // sync). Baseline is built from the same seed, so this never reads as dirty.
  const url = seedUrl(request.url, request.queryParams)
  return {
    name: request.name,
    method: request.method,
    url,
    description: request.description,
    headers: request.headers,
    queryParams: paramsFromUrl(url, request.queryParams),
    body: request.body,
    auth: request.auth,
    scripts: request.scripts,
  }
}

/**
 * Local editing state for one request, seeded from the server copy.
 *
 * ⚠️ **The seeding effect keys on `request?.id`, never on `request`.** RTK Query
 * hands back a new object identity on every background refetch — a window
 * refocus, a tag invalidation, a poll — so depending on the object re-seeds the
 * draft mid-typing and silently discards whatever the user had entered. It is
 * the worst bug available in this pane precisely because it is intermittent and
 * presents as a dropped keystroke rather than as data loss. The saved response
 * is written back explicitly by `applySaved` instead.
 */
export function useRequestDraft(request: ApiRequest | undefined) {
  const [draft, setDraft] = useState<RequestDraft | null>(null)
  const [baseline, setBaseline] = useState<RequestDraft | null>(null)

  useEffect(() => {
    if (!request) return
    setDraft(toDraft(request))
    setBaseline(toDraft(request))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id])

  const patch = useCallback(
    (changes: Partial<RequestDraft>) =>
      setDraft((current) => (current ? { ...current, ...changes } : current)),
    [],
  )

  /** Called with the save response, so the draft tracks what was persisted. */
  const applySaved = useCallback((saved: ApiRequest) => {
    setBaseline(toDraft(saved))
  }, [])

  const isDirty = useMemo(
    () =>
      draft !== null &&
      baseline !== null &&
      JSON.stringify(draft) !== JSON.stringify(baseline),
    [draft, baseline],
  )

  /**
   * Only what actually changed. Keeping the patch minimal is what lets
   * `updateRequest` decide whether the sidebar needs invalidating at all — a
   * blanket patch would always contain `name` and refetch the tree every save.
   */
  const changes = useMemo<UpdateApiRequestInput>(() => {
    if (!draft || !baseline) return {}
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(draft) as (keyof RequestDraft)[]) {
      if (JSON.stringify(draft[key]) !== JSON.stringify(baseline[key])) {
        result[key] = draft[key]
      }
    }
    return result as UpdateApiRequestInput
  }, [draft, baseline])

  return { draft, patch, isDirty, changes, applySaved }
}
