import type {
  Paginated,
  PaginationQuery,
  SessionSummary,
} from '@raven/contracts'
import { baseApi } from '../../app/baseApi'

export const sessionsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listSessions: builder.query<
      Paginated<SessionSummary>,
      PaginationQuery | void
    >({
      query: (params) => ({
        url: 'sessions',
        params: params ? { ...params } : {},
      }),
      providesTags: (result) =>
        result
          ? [
              ...result.data.map(({ id }) => ({
                type: 'Session' as const,
                id,
              })),
              { type: 'Session' as const, id: 'LIST' },
            ]
          : [{ type: 'Session' as const, id: 'LIST' }],
    }),
    revokeSession: builder.mutation<void, string>({
      query: (id) => ({ url: `sessions/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'Session', id: 'LIST' }],
    }),
  }),
})

export const { useListSessionsQuery, useRevokeSessionMutation } = sessionsApi
