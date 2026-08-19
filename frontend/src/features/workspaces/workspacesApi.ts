import type {
  CreateWorkspaceInput,
  Paginated,
  PaginationQuery,
  UpdateWorkspaceInput,
  Workspace,
} from '@postman-clone/contracts'
import { baseApi } from '../../app/baseApi'

/**
 * Extends the single `baseApi` with `injectEndpoints` rather than calling
 * `createApi` again — one cache, one middleware, one place for auth headers
 * and 401 refresh.
 */
export const workspacesApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getWorkspaces: builder.query<Paginated<Workspace>, PaginationQuery | void>({
      query: (params) => ({
        url: 'workspaces',
        params: params ? { ...params } : {},
      }),
      providesTags: (result) =>
        result
          ? [
              ...result.data.map(({ id }) => ({
                type: 'Workspace' as const,
                id,
              })),
              { type: 'Workspace' as const, id: 'LIST' },
            ]
          : [{ type: 'Workspace' as const, id: 'LIST' }],
    }),

    createWorkspace: builder.mutation<Workspace, CreateWorkspaceInput>({
      query: (body) => ({ url: 'workspaces', method: 'POST', body }),
      invalidatesTags: [{ type: 'Workspace', id: 'LIST' }],
    }),

    updateWorkspace: builder.mutation<
      Workspace,
      { id: string; changes: UpdateWorkspaceInput }
    >({
      query: ({ id, changes }) => ({
        url: `workspaces/${id}`,
        method: 'PATCH',
        body: changes,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Workspace', id },
        { type: 'Workspace', id: 'LIST' },
      ],
    }),

    deleteWorkspace: builder.mutation<void, string>({
      query: (id) => ({ url: `workspaces/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'Workspace', id: 'LIST' }],
    }),
  }),
})

export const {
  useGetWorkspacesQuery,
  useCreateWorkspaceMutation,
  useUpdateWorkspaceMutation,
  useDeleteWorkspaceMutation,
} = workspacesApi
