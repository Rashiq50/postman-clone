import type {
  CreateEnvironmentInput,
  Environment,
  Paginated,
  UpdateEnvironmentInput,
  Workspace,
} from '@postman-clone/contracts'
import { baseApi } from '../../app/baseApi'
import { workspacesApi } from '../workspaces/workspacesApi'

/**
 * Environments, and the caller's active one.
 *
 * The `Environment` tag arrived with this feature under the standing rule in
 * [baseApi](../../app/baseApi.ts): a tag may exist once something *reads* the
 * thing it names. Before interpolation nothing did.
 */
export const environmentsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getEnvironments: builder.query<Paginated<Environment>, string>({
      query: (workspaceId) => ({
        url: `workspaces/${workspaceId}/environments`,
      }),
      providesTags: (result, _error, workspaceId) =>
        result
          ? [
              ...result.data.map(({ id }) => ({
                type: 'Environment' as const,
                id,
              })),
              { type: 'Environment' as const, id: `LIST-${workspaceId}` },
            ]
          : [{ type: 'Environment' as const, id: `LIST-${workspaceId}` }],
    }),

    createEnvironment: builder.mutation<Environment, CreateEnvironmentInput>({
      query: (body) => ({ url: 'environments', method: 'POST', body }),
      invalidatesTags: (_result, _error, { workspaceId }) => [
        { type: 'Environment', id: `LIST-${workspaceId}` },
      ],
    }),

    updateEnvironment: builder.mutation<
      Environment,
      { id: string; workspaceId: string; changes: UpdateEnvironmentInput }
    >({
      query: ({ id, changes }) => ({
        url: `environments/${id}`,
        method: 'PATCH',
        body: changes,
      }),
      invalidatesTags: (_result, _error, { id, workspaceId }) => [
        { type: 'Environment', id },
        { type: 'Environment', id: `LIST-${workspaceId}` },
      ],
    }),

    deleteEnvironment: builder.mutation<
      void,
      { id: string; workspaceId: string }
    >({
      query: ({ id }) => ({ url: `environments/${id}`, method: 'DELETE' }),
      invalidatesTags: (_result, _error, { workspaceId }) => [
        { type: 'Environment', id: `LIST-${workspaceId}` },
      ],
      /**
       * Deleting the *active* environment leaves the member row pointing at
       * nothing — the FK is `ON DELETE SET NULL` — so the cached workspace has
       * to follow, or the picker keeps showing a name that no longer exists
       * and every send silently stops resolving `{{var}}`.
       */
      async onQueryStarted({ id, workspaceId }, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled
        } catch {
          return
        }
        dispatch(
          workspacesApi.util.updateQueryData(
            'getWorkspaces',
            undefined,
            (draft) => {
              for (const workspace of draft.data) {
                if (
                  workspace.id === workspaceId &&
                  workspace.activeEnvironmentId === id
                ) {
                  workspace.activeEnvironmentId = null
                }
              }
            },
          ),
        )
      },
    }),

    /**
     * The caller's own preference, `PUT` because `null` is a value rather than
     * an omission.
     *
     * ⚠️ Patched into the `getWorkspaces` cache optimistically rather than
     * invalidated — the `treePatch` doctrine. An invalidation would refetch the
     * whole workspace list to change one field, on every environment switch.
     */
    setActiveEnvironment: builder.mutation<
      Workspace,
      { workspaceId: string; environmentId: string | null }
    >({
      query: ({ workspaceId, environmentId }) => ({
        url: `workspaces/${workspaceId}/active-environment`,
        method: 'PUT',
        body: { environmentId },
      }),
      async onQueryStarted(
        { workspaceId, environmentId },
        { dispatch, queryFulfilled },
      ) {
        const patch = dispatch(
          workspacesApi.util.updateQueryData(
            'getWorkspaces',
            undefined,
            (draft) => {
              const workspace = draft.data.find(
                (candidate) => candidate.id === workspaceId,
              )
              if (workspace) workspace.activeEnvironmentId = environmentId
            },
          ),
        )
        try {
          await queryFulfilled
        } catch {
          // A single-field patch on a list nothing else is mutating, so
          // `undo()` is safe here — unlike the tree's structural operations,
          // where a patch applied after other patches can mis-apply.
          patch.undo()
        }
      },
    }),
  }),
})

export const {
  useGetEnvironmentsQuery,
  useCreateEnvironmentMutation,
  useUpdateEnvironmentMutation,
  useDeleteEnvironmentMutation,
  useSetActiveEnvironmentMutation,
} = environmentsApi
