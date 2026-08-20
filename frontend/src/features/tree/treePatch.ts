import type { WorkspaceTree } from '@postman-clone/contracts'
import { baseApi } from '../../app/baseApi'
import type { AppDispatch } from '../../app/store'
import { treeApi, treeTag } from './treeApi'

/**
 * The two things a mutation's `onQueryStarted` does to the sidebar cache.
 *
 * They exist so the `updateQueryData('getTree', …)` string and the resync tag
 * are written once rather than in fourteen mutations — the endpoint name is a
 * string literal RTK Query cannot check against a typo, and a mistyped one
 * silently patches nothing.
 */

/**
 * Just enough of the mutation lifecycle API to dispatch. The import of
 * `AppDispatch` is type-only, so `verbatimModuleSyntax` emits nothing and the
 * apparent `store → baseApi → … → treePatch → store` loop does not exist at
 * runtime — the same argument that lets `baseApi` read `RootState`.
 */
interface Dispatching {
  dispatch: AppDispatch
}

/** Applies a recipe to the cached tree; the result can be `.undo()`ne. */
export function patchTree(
  { dispatch }: Dispatching,
  workspaceId: string,
  recipe: (draft: WorkspaceTree) => void,
) {
  return dispatch(treeApi.util.updateQueryData('getTree', workspaceId, recipe))
}

/**
 * The rollback for structural edits: throw the patched cache away and refetch.
 * See the note in `collectionsApi` for why this is not `patch.undo()`.
 */
export function resyncTree({ dispatch }: Dispatching, workspaceId: string) {
  dispatch(baseApi.util.invalidateTags([...treeTag(workspaceId)]))
}
