import type {
  CollectionNode,
  FolderNode,
  RequestNode,
  WorkspaceTree,
} from '@postman-clone/contracts'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useAppDispatch } from '../../app/hooks'
import { errorMessage } from '../../lib/api-error'
import {
  useCreateCollectionMutation,
  useDeleteCollectionMutation,
  useMoveCollectionMutation,
  useUpdateCollectionMutation,
} from '../collections/collectionsApi'
import {
  useCreateFolderMutation,
  useDeleteFolderMutation,
  useMoveFolderMutation,
  useUpdateFolderMutation,
} from '../folders/foldersApi'
import {
  useCreateRequestMutation,
  useDeleteRequestMutation,
  useMoveRequestMutation,
  useUpdateRequestMutation,
} from '../requests/requestsApi'
import { CollectionNodeView } from './CollectionNodeView'
import type { TreeHandlers } from './FolderNodeView'
import { MoveToDialog } from './MoveToDialog'
import { moveTargets, type MoveTarget } from './moveTargets'
import type { MenuItem } from './NodeMenu'
import { treeApi, useGetTreeQuery } from './treeApi'
import { useExpanded } from './useExpanded'

type NodeKind = 'collection' | 'folder' | 'request'

/** The ancestor chain of a request, so a deep link opens visible. */
function ancestorsOf(tree: WorkspaceTree | undefined, requestId: string): string[] {
  if (!tree) return []

  const walkFolders = (
    folders: readonly FolderNode[],
    trail: string[],
  ): string[] | null => {
    for (const folder of folders) {
      const here = [...trail, folder.id]
      if (folder.requests.some((r) => r.id === requestId)) return here
      const deeper = walkFolders(folder.folders, here)
      if (deeper) return deeper
    }
    return null
  }

  for (const collection of tree.collections) {
    if (collection.requests.some((r) => r.id === requestId)) return [collection.id]
    const inFolders = walkFolders(collection.folders, [collection.id])
    if (inFolders) return inFolders
  }
  return []
}

interface MoveDialogState {
  kind: 'folder' | 'request'
  node: { id: string; name: string }
  currentParentId: string | null
  excludeSubtreeOf?: string
}

export function Sidebar() {
  const { workspaceId, requestId } = useParams<{
    workspaceId: string
    requestId?: string
  }>()
  const navigate = useNavigate()
  const dispatch = useAppDispatch()

  const { data: tree, isLoading, error } = useGetTreeQuery(workspaceId!, {
    skip: !workspaceId,
  })

  const { isExpanded, toggle, expandAll } = useExpanded()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [moveDialog, setMoveDialog] = useState<MoveDialogState | null>(null)

  const [createCollection] = useCreateCollectionMutation()
  const [updateCollection] = useUpdateCollectionMutation()
  const [moveCollection] = useMoveCollectionMutation()
  const [deleteCollection] = useDeleteCollectionMutation()
  const [createFolder] = useCreateFolderMutation()
  const [updateFolder] = useUpdateFolderMutation()
  const [moveFolder] = useMoveFolderMutation()
  const [deleteFolder] = useDeleteFolderMutation()
  const [createRequest] = useCreateRequestMutation()
  const [updateRequest] = useUpdateRequestMutation()
  const [moveRequest] = useMoveRequestMutation()
  const [deleteRequest] = useDeleteRequestMutation()

  // Open the active request's ancestors once the tree arrives, so a deep link
  // or a reload lands with the request visible rather than buried.
  const ancestors = useMemo(
    () => (requestId ? ancestorsOf(tree, requestId) : []),
    [tree, requestId],
  )
  useEffect(() => expandAll(ancestors), [ancestors, expandAll])

  if (!workspaceId) return null

  const ws = workspaceId

  /**
   * Inline rename is the **only** optimistic update in this feature, and
   * deliberately so: it is the one operation where the round trip is a visible
   * flicker on the exact element the user is looking at. Everything else
   * refetches — gold-plating the rest would buy nothing and cost a rollback
   * path per mutation.
   */
  async function commitRename(kind: NodeKind, id: string, name: string) {
    setRenamingId(null)

    const patch = dispatch(
      treeApi.util.updateQueryData('getTree', ws, (draft) => {
        const renameIn = (nodes: { id: string; name: string }[]) => {
          const found = nodes.find((n) => n.id === id)
          if (found) found.name = name
          return Boolean(found)
        }
        const walk = (folders: FolderNode[]): boolean => {
          for (const folder of folders) {
            if (folder.id === id) {
              folder.name = name
              return true
            }
            if (renameIn(folder.requests)) return true
            if (walk(folder.folders)) return true
          }
          return false
        }
        for (const collection of draft.collections as CollectionNode[]) {
          if (collection.id === id) {
            collection.name = name
            return
          }
          if (renameIn(collection.requests)) return
          if (walk(collection.folders)) return
        }
      }),
    )

    try {
      if (kind === 'collection') {
        await updateCollection({ id, workspaceId: ws, changes: { name } }).unwrap()
      } else if (kind === 'folder') {
        await updateFolder({ id, workspaceId: ws, changes: { name } }).unwrap()
      } else {
        await updateRequest({ id, workspaceId: ws, changes: { name } }).unwrap()
      }
    } catch {
      // The server rejected it — put the old name back rather than leaving the
      // sidebar showing an edit that never landed.
      patch.undo()
    }
  }

  function menuFor(
    kind: NodeKind,
    node: { id: string; name: string },
    context: { collectionId: string; siblings: readonly { id: string }[] },
  ): MenuItem[] {
    const index = context.siblings.findIndex((s) => s.id === node.id)
    const canUp = index > 0
    const canDown = index >= 0 && index < context.siblings.length - 1

    const reorder = (delta: number) => {
      const target = index + delta
      if (kind === 'collection') {
        void moveCollection({ id: node.id, workspaceId: ws, index: target })
        return
      }
      if (kind === 'folder') {
        const folder = findFolder(tree, node.id)
        void moveFolder({
          id: node.id,
          workspaceId: ws,
          parentFolderId: folder?.parentFolderId ?? null,
          index: target,
        })
        return
      }
      const request = findRequest(tree, node.id)
      void moveRequest({
        id: node.id,
        workspaceId: ws,
        folderId: request?.folderId ?? null,
        index: target,
      })
    }

    const items: MenuItem[] = [
      { label: 'Rename', onSelect: () => setRenamingId(node.id) },
    ]

    if (kind !== 'request') {
      items.push({
        label: 'New folder',
        onSelect: () => {
          const name = window.prompt('Folder name', 'New folder')?.trim()
          if (!name) return
          void createFolder({
            workspaceId: ws,
            collectionId: context.collectionId,
            parentFolderId: kind === 'folder' ? node.id : null,
            name,
          })
          toggle(node.id)
        },
      })
      items.push({
        label: 'New request',
        onSelect: () => {
          const name = window.prompt('Request name', 'New request')?.trim()
          if (!name) return
          void createRequest({
            workspaceId: ws,
            collectionId: context.collectionId,
            folderId: kind === 'folder' ? node.id : null,
            name,
          })
          toggle(node.id)
        },
      })
    }

    items.push({ label: 'Move up', onSelect: () => reorder(-1), disabled: !canUp })
    items.push({
      label: 'Move down',
      onSelect: () => reorder(1),
      disabled: !canDown,
    })

    if (kind !== 'collection') {
      items.push({
        label: 'Move to…',
        onSelect: () => {
          if (kind === 'folder') {
            const folder = findFolder(tree, node.id)
            setMoveDialog({
              kind,
              node,
              currentParentId: folder?.parentFolderId ?? null,
              excludeSubtreeOf: node.id,
            })
          } else {
            const request = findRequest(tree, node.id)
            setMoveDialog({
              kind,
              node,
              currentParentId: request?.folderId ?? null,
            })
          }
        },
      })
    }

    items.push({
      label: 'Delete',
      danger: true,
      onSelect: () => {
        // `window.confirm` for now, and saying so plainly: a real dialog with
        // focus management is deferred, not forgotten.
        if (!window.confirm(`Delete “${node.name}”? This cannot be undone.`)) {
          return
        }
        if (kind === 'collection') {
          void deleteCollection({ id: node.id, workspaceId: ws })
        } else if (kind === 'folder') {
          void deleteFolder({ id: node.id, workspaceId: ws })
        } else {
          void deleteRequest({ id: node.id, workspaceId: ws })
        }
        // If the open request just went away — directly or with its parent —
        // fall back to the empty state rather than leaving a stale pane.
        if (requestId && subtreeContains(tree, node.id, requestId)) {
          void navigate(`/w/${ws}`, { replace: true })
        }
      },
    })

    return items
  }

  const handlers: TreeHandlers = {
    isExpanded,
    toggle,
    renamingId,
    startRename: setRenamingId,
    cancelRename: () => setRenamingId(null),
    commitRename: (kind, id, name) => void commitRename(kind, id, name),
    openRequest: (id) => void navigate(`/w/${ws}/requests/${id}`),
    activeRequestId: requestId,
    menuFor,
  }

  const onMoveConfirmed = (target: MoveTarget) => {
    if (!moveDialog) return
    if (moveDialog.kind === 'folder') {
      void moveFolder({
        id: moveDialog.node.id,
        workspaceId: ws,
        parentFolderId: target.id,
      })
    } else {
      void moveRequest({
        id: moveDialog.node.id,
        workspaceId: ws,
        folderId: target.id,
      })
    }
    setMoveDialog(null)
  }

  return (
    <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Collections
        </h2>
        <button
          type="button"
          onClick={() => {
            const name = window.prompt('Collection name', 'New collection')?.trim()
            if (name) void createCollection({ workspaceId: ws, name })
          }}
          className="rounded px-1.5 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="New collection"
        >
          <span aria-hidden>+</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {isLoading && <p className="px-3 py-2 text-sm text-slate-400">Loading…</p>}

        {error && (
          <p className="px-3 py-2 text-sm text-red-600">
            {errorMessage(error, 'Could not load this workspace.')}
          </p>
        )}

        {tree?.collections.length === 0 && (
          <p className="px-3 py-4 text-sm text-slate-400">
            No collections yet. Use <span aria-hidden>+</span> above to create
            one.
          </p>
        )}

        {tree?.collections.map((collection) => (
          <CollectionNodeView
            key={collection.id}
            node={collection}
            siblings={tree.collections}
            handlers={handlers}
          />
        ))}
      </div>

      {moveDialog && tree && (
        <MoveToDialog
          title={`Move “${moveDialog.node.name}” to…`}
          targets={moveTargets(tree.collections, moveDialog.excludeSubtreeOf)}
          currentParentId={moveDialog.currentParentId}
          onMove={onMoveConfirmed}
          onClose={() => setMoveDialog(null)}
        />
      )}
    </aside>
  )
}

// ------------------------------------------------------------------ helpers

function findFolder(
  tree: WorkspaceTree | undefined,
  id: string,
): FolderNode | undefined {
  const walk = (folders: readonly FolderNode[]): FolderNode | undefined => {
    for (const folder of folders) {
      if (folder.id === id) return folder
      const deeper = walk(folder.folders)
      if (deeper) return deeper
    }
    return undefined
  }
  for (const collection of tree?.collections ?? []) {
    const found = walk(collection.folders)
    if (found) return found
  }
  return undefined
}

function findRequest(
  tree: WorkspaceTree | undefined,
  id: string,
): RequestNode | undefined {
  const walk = (folders: readonly FolderNode[]): RequestNode | undefined => {
    for (const folder of folders) {
      const here = folder.requests.find((r) => r.id === id)
      if (here) return here
      const deeper = walk(folder.folders)
      if (deeper) return deeper
    }
    return undefined
  }
  for (const collection of tree?.collections ?? []) {
    const here = collection.requests.find((r) => r.id === id)
    if (here) return here
    const found = walk(collection.folders)
    if (found) return found
  }
  return undefined
}

/** Whether deleting `rootId` would also remove `requestId`. */
function subtreeContains(
  tree: WorkspaceTree | undefined,
  rootId: string,
  requestId: string,
): boolean {
  if (rootId === requestId) return true

  const folderHolds = (folder: FolderNode): boolean =>
    folder.requests.some((r) => r.id === requestId) ||
    folder.folders.some(folderHolds)

  const folder = findFolder(tree, rootId)
  if (folder) return folderHolds(folder)

  const collection = tree?.collections.find((c) => c.id === rootId)
  if (collection) {
    return (
      collection.requests.some((r) => r.id === requestId) ||
      collection.folders.some(folderHolds)
    )
  }
  return false
}
