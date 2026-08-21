import { NavLink } from 'react-router'
import { BrandMark } from './AuthArt'
import { useAppSelector } from '../../app/hooks'
import { EnvironmentPicker } from '../environments/EnvironmentPicker'
import { ThemeMenu } from '../theme/ThemeMenu'
import { WorkspaceSwitcher } from '../workspaces/WorkspaceSwitcher'
import { useLogoutMutation, useMeQuery } from './authApi'
import { selectCurrentUser } from './authSlice'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium transition ${
    isActive
      ? 'bg-accent-soft text-accent-soft-fg'
      : 'text-fg-muted hover:bg-surface-muted'
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
    // `glass` rather than `glass-tint`: the header's dropdowns portal to
    // `body`, so nothing inside it is positioned against it, and the wash it
    // sits over is exactly the part of the canvas a blur has something to do
    // with — the corner where the gradients are steepest.
    <header className="border-b border-line bg-surface glass">
      <div
        className={`flex items-center gap-2 py-3 ${
          wide ? 'w-full px-4' : 'mx-auto max-w-3xl px-4'
        }`}
      >
        {/* The mark is a link home, which is what a logo in a header is for.
            `hidden sm:flex` — on a phone the nav needs the width more than the
            brand does, and the title bar already carries the name. */}
        <NavLink
          to="/"
          aria-label="Raven — workspace"
          className="mr-1 hidden items-center gap-2 rounded-md px-1 py-1 text-accent transition hover:bg-surface-muted sm:flex"
        >
          <BrandMark className="size-6" />
          <span className="text-sm font-semibold tracking-tight text-fg">
            Raven
          </span>
        </NavLink>

        <nav className="flex flex-1 items-center gap-1">
          <NavLink to="/" end className={linkClass}>
            Workspace
          </NavLink>
          <NavLink to="/sessions" className={linkClass}>
            Sessions
          </NavLink>
        </nav>

        <WorkspaceSwitcher />

        {/* Renders nothing outside a workspace route — the preference is per
            (member, workspace). */}
        <EnvironmentPicker />

        <ThemeMenu />

        {user && (
          <span className="hidden text-sm text-fg-subtle sm:inline">
            {user.name}
          </span>
        )}

        {/* No navigate() needed: `loggedOut` flips `isAuthenticated`, and
            RequireAuth redirects on the next render. */}
        <button
          type="button"
          onClick={() => void logout()}
          disabled={isLoading}
          className="rounded-md px-2 py-1.5 text-sm font-medium text-fg-muted transition hover:bg-surface-muted disabled:opacity-50"
        >
          {isLoading ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </header>
  )
}
