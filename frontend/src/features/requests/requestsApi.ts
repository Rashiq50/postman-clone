import type {
  ApiRequest,
  CreateApiRequestInput,
  MoveApiRequestInput,
  UpdateApiRequestInput,
} from '@raven/contracts'
import { baseApi } from '../../app/baseApi'
import {
  insertRequest,
  moveNode,
  removeNode,
  renameNode,
  setRequestMethod,
} from '../tree/treeCache'
import { patchTree, resyncTree } from '../tree/treePatch'

export const requestsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getRequest: builder.query<ApiRequest, string>({
      query: (id) => ({ url: `requests/${id}` }),
      providesTags: (_result, _error, id) => [{ type: 'Request', id }],
    }),

    createRequest: builder.mutation<
      ApiRequest,
      CreateApiRequestInput & { workspaceId: string }
    >({
      query: ({ workspaceId: _workspaceId, ...body }) => ({
        url: 'requests',
        method: 'POST',
        body,
      }),
      async onQueryStarted({ workspaceId }, api) {
        try {
          const { data } = await api.queryFulfilled
          patchTree(api, workspaceId, (draft) => insertRequest(draft, data))
        } catch {
          // Nothing was patched; the mutation's error state is the report.
        }
      },
    }),

    updateRequest: builder.mutation<
      ApiRequest,
      { id: string; workspaceId: string; changes: UpdateApiRequestInput }
    >({
      query: ({ id, changes }) => ({
        url: `requests/${id}`,
        method: 'PATCH',
        body: changes,
      }),
      /**
       * ⚠️ `Request:id` and **nothing else**. The sidebar used to be refreshed
       * from here by invalidating `Tree` when `name` or `method` was in the
       * patch; it is now *patched* instead, in `onQueryStarted` below. The
       * `Request` invalidation stays — the editor's own cache entry has to
       * become truthful, and that is a single small response.
       */
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Request', id }],
      // `name` and `method` are the only two fields of a request the sidebar
      // draws, so every other save (a header, a body, a script) touches no tree
      // state at all and this is a no-op.
      async onQueryStarted({ id, workspaceId, changes }, api) {
        const { name, method } = changes
        if (name === undefined && method === undefined) return

        const patch = patchTree(api, workspaceId, (draft) => {
          if (name !== undefined) renameNode(draft, id, name)
          if (method !== undefined) setRequestMethod(draft, id, method)
        })
        try {
          await api.queryFulfilled
        } catch {
          patch.undo()
        }
      },
    }),

    moveRequest: builder.mutation<
      ApiRequest,
      { id: string; workspaceId: string } & MoveApiRequestInput
    >({
      query: ({ id, workspaceId: _workspaceId, ...body }) => ({
        url: `requests/${id}/move`,
        method: 'PATCH',
        body,
      }),
      // The request's own `folderId` changed server-side, so the editor's copy
      // of it is stale — the tree, by contrast, is patched rather than refetched.
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Request', id }],
      async onQueryStarted({ id, workspaceId, folderId, index }, api) {
        patchTree(api, workspaceId, (draft) =>
          moveNode(
            draft,
            id,
            folderId ? { kind: 'folder', folderId } : { kind: 'root' },
            index,
          ),
        )
        try {
          await api.queryFulfilled
        } catch {
          resyncTree(api, workspaceId)
        }
      },
    }),

    deleteRequest: builder.mutation<void, { id: string; workspaceId: string }>({
      query: ({ id }) => ({ url: `requests/${id}`, method: 'DELETE' }),
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
  useGetRequestQuery,
  useCreateRequestMutation,
  useUpdateRequestMutation,
  useMoveRequestMutation,
  useDeleteRequestMutation,
} = requestsApi
