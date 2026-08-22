import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { PromptDialog } from '../../components/ui/PromptDialog'
import { ImportDialog } from '../import/ImportDialog'
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
import { MoveToDialog } from './MoveToDialog'
import { moveTargets, type MoveTarget } from './moveTargets'
import type { MenuItem } from './NodeMenu'
import { ancestorsOf, subtreeContains } from './treeCache'
import type { MenuContext, NodeKind, TreeHandlers } from './treeHandlers'
import { useGetTreeQuery } from './treeApi'
import { useTreeUiStore } from './treeUi'

/**
 * ⚠️ The prompt and confirm state hold **callbacks**, which is what lets the
 * memoized `handlers` object keep working: `setPrompt`/`setConfirm` are stable
 * `useState` setters, so nothing new enters the memo's dependency array and no
 * row re-renders. The alternative — a discriminated union of every action, and
 * a switch to run it on confirm — would put the action's arguments in state and
 * split each operation across two places.
 */
interface PromptState {
  title: string
  label: string
  initialValue: string
  confirmLabel: string
  onSubmit: (value: string) => void
}

interface ConfirmState {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
}

interface MoveDialogState {
  kind: 'folder' | 'request'
  node: { id: string; name: string }
  currentParentId: string | null
  /** Needed as well as the parent id: a collection root's id is `null`, so the
   *  two together are what identify where the node sits today. */
  currentCollectionId: string
  excludeSubtreeOf?: string
}

export function Sidebar() {
  const { workspaceId, requestId } = useParams<{
    workspaceId: string
    requestId?: string
  }>()
  const navigate = useNavigate()

  const {
    data: tree,
    isLoading,
    error,
  } = useGetTreeQuery(workspaceId!, {
    skip: !workspaceId,
    // ⚠️ Scoped to this endpoint, not switched on globally. Structural edits
    // now patch the cache instead of refetching, so the cache can drift —
    // another tab, another workspace member, or the backend renumbering a
    // sibling set. Focus is the right moment to true it up: a hidden tab's
    // staleness is invisible by definition, and the instant a user *sees* a tab
    // is the instant it refetches. There is deliberately no push channel — no
    // `BroadcastChannel`, no socket — for the same reason auth has none.
    refetchOnFocus: true,
    refetchOnReconnect: true,
  })

  const ui = useTreeUiStore(workspaceId)
  const [moveDialog, setMoveDialog] = useState<MoveDialogState | null>(null)
  const [prompt, setPrompt] = useState<PromptState | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  /**
   * ⚠️ Plain local state, and deliberately **not** reachable from
   * `TreeHandlers`. Nothing in a row opens this dialog — it is a header
   * action — so putting it in the memoized handlers object would add a
   * dependency that buys nothing and risks re-rendering every mounted row when
   * it changes. The three dialog states above are in `handlers` only because
   * rows genuinely open them, and even there it is their *stable setters* that
   * are captured.
   */
  const [importing, setImporting] = useState(false)

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

  /**
   * ⚠️ The tree and the active request id reach the menu through a **ref**, not
   * through the `handlers` closure. `menuFor` needs both — to decide whether a
   * delete orphans the open request — but it runs at menu-open time, long after
   * render, and closing over them would give `handlers` a new identity on every
   * refetch and every navigation, re-rendering every mounted row. The ref is
   * always current by the time anyone clicks.
   */
  const latest = useRef({ tree, requestId })
  latest.current = { tree, requestId }

  // The highlight lives in the UI store so a navigation re-renders the two rows
  // whose highlight actually moved, rather than the whole tree. Layout effect,
  // not effect: it must land before paint or the old row stays lit for a frame.
  useLayoutEffect(() => ui.setActiveRequest(requestId), [ui, requestId])

  // Open the active request's ancestors once the tree arrives, so a deep link
  // or a reload lands with the request visible rather than buried.
  const ancestors = useMemo(
    () => (requestId ? ancestorsOf(tree, requestId) : []),
    [tree, requestId],
  )
  useEffect(() => ui.expandAll(ancestors), [ui, ancestors])

  const ws = workspaceId

  /**
   * ⚠️ Memoized, and the memo is load-bearing: every node view is `React.memo`'d
   * on this object. Its dependencies are all stable for the lifetime of the
   * sidebar — RTK Query mutation triggers, `navigate`, the UI store — so it is
   * built once per workspace and a cache patch re-renders only the rows whose
   * own slice of the tree changed.
   */
  const handlers = useMemo<TreeHandlers>(() => {
    const rename = (kind: NodeKind, id: string, name: string) => {
      // Optimistic, and the rollback is `patch.undo()` — see the mutations. The
      // patch lives there rather than here so that every call site gets it.
      ui.startRename(null)
      if (kind === 'collection') {
        void updateCollection({ id, workspaceId: ws!, changes: { name } })
      } else if (kind === 'folder') {
        void updateFolder({ id, workspaceId: ws!, changes: { name } })
      } else {
        void updateRequest({ id, workspaceId: ws!, changes: { name } })
      }
    }

    // Shared by the kebab menu's "New request" and the empty-node "Add
    // request" button, so the two cannot drift. `expandId` is the node whose
    // subtree should be open when the response patches the new request in.
    const promptNewRequest = (
      collectionId: string,
      folderId: string | null,
      expandId: string,
    ) =>
      setPrompt({
        title: 'New request',
        label: 'Request name',
        initialValue: 'New request',
        confirmLabel: 'Create',
        onSubmit: (name) => {
          void createRequest({ workspaceId: ws!, collectionId, folderId, name })
          ui.expandAll([expandId])
        },
      })

    const menuFor = (
      kind: NodeKind,
      node: { id: string; name: string },
      context: MenuContext,
    ): MenuItem[] => {
      const { index } = context
      const canUp = index > 0
      const canDown = index < context.siblingCount - 1

      const reorder = (delta: number) => {
        const target = index + delta
        if (kind === 'collection') {
          void moveCollection({ id: node.id, workspaceId: ws!, index: target })
        } else if (kind === 'folder') {
          void moveFolder({
            id: node.id,
            workspaceId: ws!,
            parentFolderId: context.parentId,
            index: target,
          })
        } else {
          void moveRequest({
            id: node.id,
            workspaceId: ws!,
            folderId: context.parentId,
            index: target,
          })
        }
      }

      const items: MenuItem[] = [
        { label: 'Rename', onSelect: () => ui.startRename(node.id) },
      ]

      if (kind !== 'request') {
        items.push({
          label: 'New folder',
          onSelect: () =>
            setPrompt({
              title: 'New folder',
              label: 'Folder name',
              initialValue: 'New folder',
              confirmLabel: 'Create',
              onSubmit: (name) => {
                void createFolder({
                  workspaceId: ws!,
                  collectionId: context.collectionId,
                  parentFolderId: kind === 'folder' ? node.id : null,
                  name,
                })
                // Expand the parent so the new child is visible when the
                // response patches it in, rather than hidden in a closed node.
                ui.expandAll([node.id])
              },
            }),
        })
        items.push({
          label: 'New request',
          onSelect: () =>
            promptNewRequest(
              context.collectionId,
              kind === 'folder' ? node.id : null,
              node.id,
            ),
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
          onSelect: () =>
            setMoveDialog({
              kind,
              node,
              currentParentId: context.parentId,
              currentCollectionId: context.collectionId,
              excludeSubtreeOf: kind === 'folder' ? node.id : undefined,
            }),
        })
      }

      items.push({
        label: 'Delete',
        danger: true,
        onSelect: () =>
          setConfirm({
            title: `Delete “${node.name}”?`,
            message:
              kind === 'request'
                ? 'This cannot be undone.'
                : 'Everything inside it is deleted too. This cannot be undone.',
            confirmLabel: 'Delete',
            danger: true,
            onConfirm: () => {
              // Read *before* the mutation: its optimistic patch removes the
              // subtree from the cache, so asking afterwards always answers
              // "no". ⚠️ It must also be read here rather than when the menu
              // item was chosen — the tree can change while the dialog is open.
              const orphansOpenRequest =
                latest.current.requestId !== undefined &&
                subtreeContains(
                  latest.current.tree,
                  node.id,
                  latest.current.requestId,
                )

              if (kind === 'collection') {
                void deleteCollection({ id: node.id, workspaceId: ws! })
              } else if (kind === 'folder') {
                void deleteFolder({ id: node.id, workspaceId: ws! })
              } else {
                void deleteRequest({ id: node.id, workspaceId: ws! })
              }
              // If the open request just went away — directly or with its
              // parent — fall back to the empty state rather than leaving a
              // stale pane.
              if (orphansOpenRequest) void navigate(`/w/${ws}`, { replace: true })
            },
          }),
      })

      return items
    }

    return {
      ui,
      cancelRename: () => ui.startRename(null),
      commitRename: rename,
      openRequest: (id) => void navigate(`/w/${ws}/requests/${id}`),
      newRequestIn: (collectionId, parentFolderId) =>
        promptNewRequest(
          collectionId,
          parentFolderId,
          parentFolderId ?? collectionId,
        ),
      menuFor,
    }
  }, [
    ui,
    ws,
    navigate,
    updateCollection,
    moveCollection,
    deleteCollection,
    createFolder,
    updateFolder,
    moveFolder,
    deleteFolder,
    createRequest,
    updateRequest,
    moveRequest,
    deleteRequest,
  ])

  if (!ws) return null

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
    /*
      ⚠️ `glass-tint`, never `glass`. A `backdrop-filter` here would make this
      element the containing block for `NodeMenu`'s panel, which is `fixed`
      solely to escape the scroll container below — the menu would be clipped
      again, on exactly the rows where it already was. There is nothing behind
      the sidebar but the canvas wash anyway, so the blur would buy nothing for
      the layer it costs.
    */
    <aside className="flex min-h-0 flex-col border-r border-line bg-surface glass-tint">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <h2 className="text-xs font-semibold tracking-wide text-fg-subtle uppercase">
          Collections
        </h2>
        <div className="flex items-center gap-1">
          {/*
            Text rather than a glyph, beside the `+`: importing is the one
            action here a new user is actively looking for, and an icon for it
            would be a guess (a tray? an arrow?) with no established meaning.
          */}
          <button
            type="button"
            onClick={() => setImporting(true)}
            className="rounded px-1.5 py-0.5 text-xs text-fg-faint hover:bg-surface-muted hover:text-fg-muted"
          >
            Import
          </button>
          <button
            type="button"
            onClick={() =>
              setPrompt({
                title: 'New collection',
                label: 'Collection name',
                initialValue: 'New collection',
                confirmLabel: 'Create',
                onSubmit: (name) => void createCollection({ workspaceId: ws, name }),
              })
            }
            className="rounded px-1.5 text-lg leading-none text-fg-faint hover:bg-surface-muted hover:text-fg-muted"
            aria-label="New collection"
          >
            <span aria-hidden>+</span>
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {isLoading && <p className="px-3 py-2 text-sm text-fg-faint">Loading…</p>}

        {error && (
          <p className="px-3 py-2 text-sm text-danger">
            {errorMessage(error, 'Could not load this workspace.')}
          </p>
        )}

        {tree?.collections.length === 0 && (
          <p className="px-3 py-4 text-sm text-fg-faint">
            No collections yet. Use <span aria-hidden>+</span> above to create
            one, or Import a Postman export.
          </p>
        )}

        {tree?.collections.map((collection, at) => (
          <CollectionNodeView
            key={collection.id}
            node={collection}
            index={at}
            siblingCount={tree.collections.length}
            handlers={handlers}
          />
        ))}
      </div>

      {prompt && (
        <PromptDialog
          title={prompt.title}
          label={prompt.label}
          initialValue={prompt.initialValue}
          confirmLabel={prompt.confirmLabel}
          onSubmit={prompt.onSubmit}
          onClose={() => setPrompt(null)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          danger={confirm.danger}
          onConfirm={confirm.onConfirm}
          onClose={() => setConfirm(null)}
        />
      )}

      {importing && (
        <ImportDialog workspaceId={ws} onClose={() => setImporting(false)} />
      )}

      {moveDialog && tree && (
        <MoveToDialog
          title={`Move “${moveDialog.node.name}” to…`}
          targets={moveTargets(tree.collections, moveDialog.excludeSubtreeOf)}
          currentParentId={moveDialog.currentParentId}
          currentCollectionId={moveDialog.currentCollectionId}
          onMove={onMoveConfirmed}
          onClose={() => setMoveDialog(null)}
        />
      )}
    </aside>
  )
}
