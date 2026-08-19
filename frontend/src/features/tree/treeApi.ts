import type { WorkspaceTree } from '@postman-clone/contracts'
import { baseApi } from '../../app/baseApi'

/**
 * ⚠️ **One `Tree` tag per workspace, not per collection.** The tree is a single
 * HTTP response, so a per-collection tag could never cause a *partial* refetch
 * — and a move between collections would force the client to know both
 * collection ids. Per-workspace is exactly as precise as the transport allows
 * and strictly simpler.
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

/** The invalidation every mutation in this feature reaches for. */
export const treeTag = (workspaceId: string) =>
  [{ type: 'Tree' as const, id: workspaceId }] as const
