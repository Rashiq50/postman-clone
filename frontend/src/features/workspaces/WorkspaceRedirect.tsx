import { Navigate } from 'react-router'
import { useGetWorkspacesQuery } from './workspacesApi'

/**
 * `/` → the user's workspace.
 *
 * The workspace id lives in the URL from here on, and that is not an aesthetic
 * choice: this codebase forbids `localStorage`, `sessionStorage` and
 * `redux-persist`, so an id kept in Redux would not survive a reload — every
 * refresh would silently drop the user into "the first workspace", a bug that
 * stays invisible until someone has two. The URL is the only persistence layer
 * this app allows, and it gives deep links, a working Back button and two tabs
 * on two workspaces for free.
 *
 * The API returns personal workspaces first, so row 0 is the right default
 * without a second pass.
 */
export function WorkspaceRedirect() {
  const { data, isLoading, isError } = useGetWorkspacesQuery()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        Loading…
      </div>
    )
  }

  const first = data?.data[0]

  if (isError || !first) {
    // Provisioning happens inside the user-creation transaction, so an account
    // without a workspace should be impossible. Saying so beats an infinite
    // spinner if it ever happens anyway.
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="max-w-sm text-center text-sm text-slate-500">
          We couldn&rsquo;t load your workspace. Try reloading the page.
        </p>
      </div>
    )
  }

  return <Navigate to={`/w/${first.id}`} replace />
}
