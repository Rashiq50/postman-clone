import type {
  Paginated,
  RequestExecution,
  RequestExecutionSummary,
  SendRequestInput,
  SendResult,
} from '@raven/contracts'
import { baseApi } from '../../app/baseApi'

/**
 * Sending, and the per-request history of sends.
 *
 * ⚠️ **`send` invalidates `Execution` for this request and nothing else — in
 * particular not `Request`.** No field of the saved request changed, and
 * invalidating it would refetch the row, which is exactly the kind of thing
 * that re-seeds a draft mid-edit if `useRequestDraft`'s effect key were ever
 * loosened from `request?.id`. Pressing Send must never disturb what the user
 * is typing.
 */
export const executionsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    sendRequest: builder.mutation<
      SendResult,
      { requestId: string } & SendRequestInput
    >({
      query: ({ requestId, ...body }) => ({
        url: `requests/${requestId}/send`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_result, _error, { requestId }) => [
        { type: 'Execution', id: requestId },
      ],
    }),

    getExecutions: builder.query<
      Paginated<RequestExecutionSummary>,
      { requestId: string }
    >({
      query: ({ requestId }) => ({ url: `requests/${requestId}/executions` }),
      providesTags: (_result, _error, { requestId }) => [
        { type: 'Execution', id: requestId },
      ],
    }),

    getExecution: builder.query<RequestExecution, string>({
      query: (id) => ({ url: `executions/${id}` }),
      providesTags: (_result, _error, id) => [{ type: 'Execution', id }],
    }),

    clearExecutions: builder.mutation<void, { requestId: string }>({
      query: ({ requestId }) => ({
        url: `requests/${requestId}/executions`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { requestId }) => [
        { type: 'Execution', id: requestId },
      ],
    }),
  }),
})

export const {
  useSendRequestMutation,
  useGetExecutionsQuery,
  useGetExecutionQuery,
  useClearExecutionsMutation,
} = executionsApi
