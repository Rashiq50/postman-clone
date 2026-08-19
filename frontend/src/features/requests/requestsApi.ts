import type {
  ApiRequest,
  CreateApiRequestInput,
  MoveApiRequestInput,
  UpdateApiRequestInput,
} from '@postman-clone/contracts'
import { baseApi } from '../../app/baseApi'
import { treeTag } from '../tree/treeApi'

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
      invalidatesTags: (_r, _e, { workspaceId }) => treeTag(workspaceId),
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
       * ⚠️ `Request:id` always; `Tree` **only when `name` or `method` changed**.
       *
       * Those two fields are the only thing the sidebar renders from a request,
       * so invalidating the tree on every save would refetch the entire
       * workspace each time someone edits a header — on a form people type in
       * constantly.
       */
      invalidatesTags: (_result, _error, { id, workspaceId, changes }) => {
        const tags = [{ type: 'Request' as const, id }]
        const touchesSidebar = 'name' in changes || 'method' in changes
        return touchesSidebar ? [...tags, ...treeTag(workspaceId)] : tags
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
      invalidatesTags: (_r, _e, { id, workspaceId }) => [
        { type: 'Request' as const, id },
        ...treeTag(workspaceId),
      ],
    }),

    deleteRequest: builder.mutation<void, { id: string; workspaceId: string }>({
      query: ({ id }) => ({ url: `requests/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, { workspaceId }) => treeTag(workspaceId),
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
