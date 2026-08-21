import type {
  Collection,
  CreateCollectionInput,
  UpdateCollectionInput,
} from '@raven/contracts'
import { baseApi } from '../../app/baseApi'
import { patchTree, resyncTree } from '../tree/treePatch'
import { insertCollection, moveNode, removeNode, renameNode } from '../tree/treeCache'

/**
 * ⚠️ Every argument here carries `workspaceId` even though the server never
 * needs it. It used to be the **invalidation key**; it is now the **patch
 * key** — `treeApi.util.updateQueryData` needs the exact query argument to
 * find the cache entry, so the field is more load-bearing than before, not
 * less. This is the field an implementer forgets, and the symptom is "the
 * sidebar doesn't update until I reload", which reads like a caching bug
 * rather than a missing argument.
 *
 * There is no `Collection` tag: collections have no read endpoint of their own
 * and exist only inside the tree.
 *
 * ⚠️ **Two rollback strategies, on purpose.** Rename undoes its patch — the
 * failure is validation-ish and the revert is exact. Structural edits (move,
 * delete) instead invalidate `Tree` and let it refetch: an `undo()` applied
 * after other patches have landed on top, or after a focus refetch replaced
 * the cache object, can mis-apply, and the error path is the one place where
 * paying for one full fetch is fine.
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
      // Response-patched, not optimistic: the row needs the server's `id` and
      // `position`. One round trip before a menu-driven row appears reads as
      // instant; a temp id with a swap on response would complicate every
      // helper for that margin.
      async onQueryStarted({ workspaceId }, api) {
        try {
          const { data } = await api.queryFulfilled
          patchTree(api, workspaceId, (draft) => insertCollection(draft, data))
        } catch {
          // The mutation's own error state is the report; the cache never
          // changed, so there is nothing to undo.
        }
      },
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
      async onQueryStarted({ id, workspaceId, changes }, api) {
        // `name` is the only field of a collection the sidebar draws.
        if (changes.name === undefined) return
        const name = changes.name
        const patch = patchTree(api, workspaceId, (draft) =>
          renameNode(draft, id, name),
        )
        try {
          await api.queryFulfilled
        } catch {
          patch.undo()
        }
      },
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
      async onQueryStarted({ id, workspaceId, index }, api) {
        patchTree(api, workspaceId, (draft) =>
          moveNode(draft, id, { kind: 'same' }, index),
        )
        try {
          await api.queryFulfilled
        } catch {
          resyncTree(api, workspaceId)
        }
      },
    }),

    deleteCollection: builder.mutation<void, { id: string; workspaceId: string }>({
      query: ({ id }) => ({ url: `collections/${id}`, method: 'DELETE' }),
      async onQueryStarted({ id, workspaceId }, api) {
        patchTree(api, workspaceId, (draft) => {
          removeNode(draft, id)
        })
        try {
          await api.queryFulfilled
        } catch {
          resyncTree(api, workspaceId)
        }
      },
    }),
  }),
})

export const {
  useCreateCollectionMutation,
  useUpdateCollectionMutation,
  useMoveCollectionMutation,
  useDeleteCollectionMutation,
} = collectionsApi
