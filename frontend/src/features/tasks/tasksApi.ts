import type {
  CreateTaskInput,
  Paginated,
  PaginationQuery,
  Task,
  UpdateTaskInput,
} from '@postman-clone/contracts'
import { baseApi } from '../../app/baseApi'

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
