import { NavLink } from 'react-router'
import { useAppSelector } from '../../app/hooks'
import { WorkspaceSwitcher } from '../workspaces/WorkspaceSwitcher'
import { useLogoutMutation, useMeQuery } from './authApi'
import { selectCurrentUser } from './authSlice'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium transition ${
    isActive
      ? 'bg-indigo-50 text-indigo-700'
      : 'text-slate-600 hover:bg-slate-100'
  }`

/**
 * `wide` swaps the centred `max-w-3xl` column for a full-width row. One prop
 * rather than a duplicated header: `AppShell` keeps the centred layout and
 * `WorkbenchShell` needs the sidebar to start at the left edge.
 */
export function AppHeader({ wide = false }: { wide?: boolean }) {
  const user = useAppSelector(selectCurrentUser)
  const [logout, { isLoading }] = useLogoutMutation()

  // Self-healing fallback: login and refresh both carry the user, so this only
  // fires if the slice somehow holds a token without one.
  useMeQuery(undefined, { skip: Boolean(user) })

  return (
    <header className="border-b border-slate-200 bg-white">
      <div
        className={`flex items-center gap-2 py-3 ${
          wide ? 'w-full px-4' : 'mx-auto max-w-3xl px-4'
        }`}
      >
        <nav className="flex flex-1 items-center gap-1">
          <NavLink to="/" end className={linkClass}>
            Workspace
          </NavLink>
          <NavLink to="/tasks" className={linkClass}>
            Tasks
          </NavLink>
          <NavLink to="/sessions" className={linkClass}>
            Sessions
          </NavLink>
        </nav>

        <WorkspaceSwitcher />

        {user && (
          <span className="hidden text-sm text-slate-500 sm:inline">
            {user.name}
          </span>
        )}

        {/* No navigate() needed: `loggedOut` flips `isAuthenticated`, and
            RequireAuth redirects on the next render. */}
        <button
          type="button"
          onClick={() => void logout()}
          disabled={isLoading}
          className="rounded-md px-2 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
        >
          {isLoading ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </header>
  )
}
