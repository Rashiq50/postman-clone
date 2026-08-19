import type {
  Collection,
  CreateCollectionInput,
  UpdateCollectionInput,
} from '@postman-clone/contracts'
import { baseApi } from '../../app/baseApi'
import { treeTag } from '../tree/treeApi'

/**
 * ⚠️ Every argument here carries `workspaceId` even though the server never
 * needs it: it is the **invalidation key**, and a mutation has no other way to
 * reach one. This is the field an implementer forgets, and the symptom is "the
 * sidebar doesn't update until I reload" — which reads like a caching bug
 * rather than a missing argument.
 *
 * There is no `Collection` tag: collections have no read endpoint of their own
 * and exist only inside the tree, so invalidating the tree *is* the update.
 */
export const collectionsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    createCollection: builder.mutation<
      Collection,
      CreateCollectionInput & { workspaceId: string }
    >({
      query: ({ workspaceId, ...body }) => ({
        url: 'collections',
        method: 'POST',
        body: { workspaceId, ...body },
      }),
      invalidatesTags: (_r, _e, { workspaceId }) => treeTag(workspaceId),
    }),

    updateCollection: builder.mutation<
      Collection,
      { id: string; workspaceId: string; changes: UpdateCollectionInput }
    >({
      query: ({ id, changes }) => ({
        url: `collections/${id}`,
        method: 'PATCH',
        body: changes,
      }),
      invalidatesTags: (_r, _e, { workspaceId }) => treeTag(workspaceId),
    }),

    moveCollection: builder.mutation<
      Collection,
      { id: string; workspaceId: string; index: number }
    >({
      query: ({ id, index }) => ({
        url: `collections/${id}/move`,
        method: 'PATCH',
        body: { index },
      }),
      invalidatesTags: (_r, _e, { workspaceId }) => treeTag(workspaceId),
    }),

    deleteCollection: builder.mutation<void, { id: string; workspaceId: string }>({
      query: ({ id }) => ({ url: `collections/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, { workspaceId }) => treeTag(workspaceId),
    }),
  }),
})

export const {
  useCreateCollectionMutation,
  useUpdateCollectionMutation,
  useMoveCollectionMutation,
  useDeleteCollectionMutation,
} = collectionsApi
