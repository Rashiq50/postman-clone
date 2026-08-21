import type {
  CreateFolderInput,
  Folder,
  MoveFolderInput,
  UpdateFolderInput,
} from '@raven/contracts'
import { baseApi } from '../../app/baseApi'
import { insertFolder, moveNode, removeNode, renameNode } from '../tree/treeCache'
import { patchTree, resyncTree } from '../tree/treePatch'

/**
 * `workspaceId` is the cache-patch key — see the long note in
 * `collectionsApi`, including why rename undoes and move/delete resync.
 */
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
      async onQueryStarted({ workspaceId }, api) {
        try {
          const { data } = await api.queryFulfilled
          patchTree(api, workspaceId, (draft) => insertFolder(draft, data))
        } catch {
          // Nothing was patched; the mutation's error state is the report.
        }
      },
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
      async onQueryStarted({ id, workspaceId, changes }, api) {
        if (changes.name === undefined) return
        const name = changes.name
        const patch = patchTree(api, workspaceId, (draft) =>
          renameNode(draft, id, name),
        )
        try {
          await api.queryFulfilled
        } catch {
          patch.undo()
        }
      },
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
      // A folder never changes collection (the composite FK makes that
      // unrepresentable), so a null `parentFolderId` means the root of the
      // collection it is already in — which is exactly what `{ kind: 'root' }`
      // resolves against.
      async onQueryStarted({ id, workspaceId, parentFolderId, index }, api) {
        patchTree(api, workspaceId, (draft) =>
          moveNode(
            draft,
            id,
            parentFolderId ? { kind: 'folder', folderId: parentFolderId } : { kind: 'root' },
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

    deleteFolder: builder.mutation<void, { id: string; workspaceId: string }>({
      query: ({ id }) => ({ url: `folders/${id}`, method: 'DELETE' }),
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
  useCreateFolderMutation,
  useUpdateFolderMutation,
  useMoveFolderMutation,
  useDeleteFolderMutation,
} = foldersApi
