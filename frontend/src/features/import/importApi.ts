import type {
  ImportCollectionInput,
  ImportCollectionResult,
  ImportEnvironmentInput,
  ImportEnvironmentResult,
} from '@raven/contracts'
import { baseApi } from '../../app/baseApi'
import { resyncTree } from '../tree/treePatch'

/**
 * The two import endpoints.
 *
 * ⚠️ **This is the one mutation that resyncs the tree instead of patching it**,
 * and the exception is deliberate. Every other structural change is one node
 * moving, so `treeCache.ts`'s pure helpers can write it into the cache and the
 * sidebar never stalls. An import adds a whole collection with hundreds of
 * folders and requests at once — reconstructing that shape client-side would
 * mean a second mapper on this side of the wire, kept in step with the server's
 * by hand, to save one fetch on an action a user takes rarely and already waits
 * on. So: `resyncTree`, the same call the structural rollbacks make, on a path
 * where one full fetch is exactly right.
 *
 * `resyncTree` runs **after `queryFulfilled`** — a failed import changed
 * nothing, and refetching the tree on the error path would be a stall with no
 * new data at the end of it.
 *
 * ⚠️ **No new tag types.** The collection route resyncs through the existing
 * `Tree` tag; the environment route invalidates the existing `Environment` list
 * tag, exactly as `createEnvironment` does. An `Import` tag would name
 * something nothing reads.
 */
export const importApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    importCollection: builder.mutation<
      ImportCollectionResult,
      ImportCollectionInput
    >({
      query: (body) => ({ url: 'import/collection', method: 'POST', body }),
      async onQueryStarted({ workspaceId }, api) {
        await api.queryFulfilled
        resyncTree(api, workspaceId)
      },
    }),

    importEnvironment: builder.mutation<
      ImportEnvironmentResult,
      ImportEnvironmentInput
    >({
      query: (body) => ({ url: 'import/environment', method: 'POST', body }),
      invalidatesTags: (_result, _error, { workspaceId }) => [
        { type: 'Environment', id: `LIST-${workspaceId}` },
      ],
    }),
  }),
})

export const { useImportCollectionMutation, useImportEnvironmentMutation } =
  importApi
