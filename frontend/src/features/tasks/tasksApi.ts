import {
  API_PREFIX,
  API_VERSION,
  type CreateTaskInput,
  type Paginated,
  type PaginationQuery,
  type Task,
  type UpdateTaskInput,
} from '@postman-clone/contracts'
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'

// In development this stays relative and Vite proxies it. In production set
// VITE_API_URL when the API is not on the same origin as the app.
const apiRoot = import.meta.env.VITE_API_URL ?? `/${API_PREFIX}`

/**
 * The single API slice. Feature modules add their endpoints with
 * `baseApi.injectEndpoints(...)` rather than calling `createApi` again — one
 * cache, one middleware, and one place for auth headers and 401 refresh once
 * those exist.
 */
export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({ baseUrl: `${apiRoot}/v${API_VERSION}` }),
  tagTypes: ['Task'],
  endpoints: () => ({}),
})

export const tasksApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getTasks: builder.query<Paginated<Task>, PaginationQuery | void>({
      query: (params) => ({ url: 'tasks', params: params ? { ...params } : {} }),
      providesTags: (result) =>
        result
          ? [
              ...result.data.map(({ id }) => ({ type: 'Task' as const, id })),
              { type: 'Task' as const, id: 'LIST' },
            ]
          : [{ type: 'Task' as const, id: 'LIST' }],
    }),
    createTask: builder.mutation<Task, CreateTaskInput>({
      query: (body) => ({ url: 'tasks', method: 'POST', body }),
      invalidatesTags: [{ type: 'Task', id: 'LIST' }],
    }),
    updateTask: builder.mutation<Task, { id: string; changes: UpdateTaskInput }>(
      {
        query: ({ id, changes }) => ({
          url: `tasks/${id}`,
          method: 'PATCH',
          body: changes,
        }),
        invalidatesTags: (_result, _error, { id }) => [
          { type: 'Task', id },
          { type: 'Task', id: 'LIST' },
        ],
      },
    ),
    deleteTask: builder.mutation<void, string>({
      query: (id) => ({ url: `tasks/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'Task', id: 'LIST' }],
    }),
  }),
})

export const {
  useGetTasksQuery,
  useCreateTaskMutation,
  useUpdateTaskMutation,
  useDeleteTaskMutation,
} = tasksApi
