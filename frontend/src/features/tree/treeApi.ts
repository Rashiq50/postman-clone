import type { WorkspaceTree } from '@postman-clone/contracts'
import { baseApi } from '../../app/baseApi'

/**
 * ⚠️ **One `Tree` tag per workspace, not per collection.** The tree is a single
 * HTTP response, so a per-collection tag could never cause a *partial* refetch
 * — and a move between collections would force the client to know both
 * collection ids. Per-workspace is exactly as precise as the transport allows
 * and strictly simpler.
 *
 * ⚠️ **Mutations no longer invalidate this tag on the happy path.** They patch
 * the cached tree directly (`features/tree/treeCache.ts`, dispatched from each
 * mutation's `onQueryStarted` via `treePatch.ts`), because a refetch of the
 * whole workspace after every rename, move and delete is a visible stall once a
 * workspace has hundreds of collections. The tag still has two jobs and must
 * not be deleted: it is the rollback for a failed structural edit, and it is
 * what `refetchOnFocus` reconciles against.
 */
export const treeApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getTree: builder.query<WorkspaceTree, string>({
      query: (workspaceId) => ({ url: `workspaces/${workspaceId}/tree` }),
      providesTags: (_result, _error, workspaceId) => [
        { type: 'Tree', id: workspaceId },
      ],
    }),
  }),
})

export const { useGetTreeQuery } = treeApi

/** The error-path resync — see the note above; no longer a per-mutation tag. */
export const treeTag = (workspaceId: string) =>
  [{ type: 'Tree' as const, id: workspaceId }] as const
