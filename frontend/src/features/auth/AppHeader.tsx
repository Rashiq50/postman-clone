import { NavLink } from 'react-router'
import { useAppSelector } from '../../app/hooks'
import { useLogoutMutation, useMeQuery } from './authApi'
import { selectCurrentUser } from './authSlice'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium transition ${
    isActive
      ? 'bg-indigo-50 text-indigo-700'
      : 'text-slate-600 hover:bg-slate-100'
  }`

export function AppHeader() {
  const user = useAppSelector(selectCurrentUser)
  const [logout, { isLoading }] = useLogoutMutation()

  // Self-healing fallback: login and refresh both carry the user, so this only
  // fires if the slice somehow holds a token without one.
  useMeQuery(undefined, { skip: Boolean(user) })

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
        <nav className="flex flex-1 items-center gap-1">
          <NavLink to="/tasks" className={linkClass}>
            Tasks
          </NavLink>
          <NavLink to="/sessions" className={linkClass}>
            Sessions
          </NavLink>
        </nav>

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
