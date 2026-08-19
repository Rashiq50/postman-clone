import type {
  CreateFolderInput,
  Folder,
  MoveFolderInput,
  UpdateFolderInput,
} from '@postman-clone/contracts'
import { baseApi } from '../../app/baseApi'
import { treeTag } from '../tree/treeApi'

/** `workspaceId` is the invalidation key — see `collectionsApi`. */
export const foldersApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    createFolder: builder.mutation<
      Folder,
      CreateFolderInput & { workspaceId: string }
    >({
      query: ({ workspaceId: _workspaceId, ...body }) => ({
        url: 'folders',
        method: 'POST',
        body,
      }),
      invalidatesTags: (_r, _e, { workspaceId }) => treeTag(workspaceId),
    }),

    updateFolder: builder.mutation<
      Folder,
      { id: string; workspaceId: string; changes: UpdateFolderInput }
    >({
      query: ({ id, changes }) => ({
        url: `folders/${id}`,
        method: 'PATCH',
        body: changes,
      }),
      invalidatesTags: (_r, _e, { workspaceId }) => treeTag(workspaceId),
    }),

    moveFolder: builder.mutation<
      Folder,
      { id: string; workspaceId: string } & MoveFolderInput
    >({
      query: ({ id, workspaceId: _workspaceId, ...body }) => ({
        url: `folders/${id}/move`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (_r, _e, { workspaceId }) => treeTag(workspaceId),
    }),

    deleteFolder: builder.mutation<void, { id: string; workspaceId: string }>({
      query: ({ id }) => ({ url: `folders/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, { workspaceId }) => treeTag(workspaceId),
    }),
  }),
})

export const {
  useCreateFolderMutation,
  useUpdateFolderMutation,
  useMoveFolderMutation,
  useDeleteFolderMutation,
} = foldersApi
