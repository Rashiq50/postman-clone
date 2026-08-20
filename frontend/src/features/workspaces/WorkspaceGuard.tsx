import { Navigate, Outlet, useParams } from 'react-router'
import { useGetWorkspacesQuery } from './workspacesApi'

/**
 * Gate for every `/w/:workspaceId` route: the id in the URL must belong to the
 * signed-in user.
 *
 * The workspace id lives in the URL (see `WorkspaceRedirect`), which means it
 * outlives the session that produced it. The path that makes this a real bug
 * rather than a hardening exercise: signing out from the header sends
 * `RequireAuth` to `/login` carrying `from = /w/<previous user's workspace>`,
 * and `LoginPage` navigates back to `from` after *whoever* signs in next. A
 * second user then lands on the first user's workspace URL — every request 404s
 * and the sidebar renders an error, which reads like a broken account.
 * Bookmarks and shared links produce the same state more slowly.
 *
 * The check runs above `WorkbenchShell` rather than inside it so the sidebar
 * never mounts against a foreign id and never fires the tree request that would
 * flash "Could not load this workspace" on the way past.
 *
 * Redirecting to `/` rather than to a message: `WorkspaceRedirect` resolves it
 * to a workspace the user actually has, so the wrong URL self-heals in one hop.
 */
export function WorkspaceGuard() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { data, isLoading, isError } = useGetWorkspacesQuery()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-fg-subtle">
        Loading…
      </div>
    )
  }

  // A failed list is not evidence that the id is wrong, and bouncing to `/`
  // would only hit the same failure there. Let it through and let the tree
  // request report whatever is actually broken.
  if (isError) return <Outlet />

  const known = data?.data.some((workspace) => workspace.id === workspaceId)

  return known ? <Outlet /> : <Navigate to="/" replace />
}
