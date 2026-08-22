import { NavLink } from 'react-router'
import { EnvironmentPicker } from '../environments/EnvironmentPicker'
import { ThemeButton } from '../theme/ThemeButton'
import { WorkspaceSwitcher } from '../workspaces/WorkspaceSwitcher'
import { BrandMark } from './AuthArt'
import { UserMenu } from './UserMenu'
import { useMeQuery } from './authApi'
import { useAppSelector } from '../../app/hooks'
import { selectCurrentUser } from './authSlice'

/**
 * The app chrome.
 *
 * ⚠️ **Everything about the account is behind one control now** — the
 * [UserMenu](UserMenu.tsx). The header used to carry a nav pair
 * (Workspace/Sessions), a workspace switcher, an environment picker, a theme
 * `Select`, the user's name and a Sign out button, all competing for one row;
 * at the workbench's width that left nothing but the brand before the controls
 * began. What is left here is what is *about the workspace you are looking at*
 * — the switcher and the environment — while who you are, where your account
 * settings live and how the app is themed moved into the menu.
 *
 * ⚠️ **The Sessions nav link is gone and that is deliberate**: `/sessions` is
 * now `/profile/sessions`, a sub-page of Profile rather than a peer of the
 * workspace, and the router keeps a redirect for the old path.
 *
 * ⚠️ **The header row is always full width, and the `wide` prop is gone.** It
 * used to inherit `AppShell`'s centred `max-w-3xl` column, so navigating from
 * the workbench to `/profile` visibly narrowed the chrome and slid the brand,
 * the pickers and the account menu inward — the app's frame appearing to resize
 * around a page change. The frame is the frame; only `<main>` centres its
 * content. Anything reintroducing that prop brings the jump back.
 */
export function AppHeader() {
  const user = useAppSelector(selectCurrentUser)

  // Self-healing fallback: login and refresh both carry the user, so this only
  // fires if the slice somehow holds a token without one. The menu renders the
  // name and email, so an empty slice is visible here in a way it was not when
  // the header showed the name alone.
  useMeQuery(undefined, { skip: Boolean(user) })

  return (
    // `glass` rather than `glass-tint`: the workspace and environment pickers
    // portal to `body`, and the user menu is `absolute` rather than `fixed`, so
    // nothing here depends on the header not being a containing block. The wash
    // it sits over is the corner where the gradients are steepest, which is
    // exactly where a blur has something to do.
    <header className="border-b border-line bg-surface glass">
      <div className="flex w-full items-center gap-2 px-4 py-2.5">
        {/* The mark is a link home, which is what a logo in a header is for.
            The name hides below `sm` — on a phone the pickers need the width
            more than the wordmark does, but the mark itself stays, so the way
            home never disappears. */}
        <NavLink
          to="/"
          aria-label="Raven — workspace"
          className="mr-1 flex items-center gap-2 rounded-md px-1 py-1 text-accent transition hover:bg-surface-muted"
        >
          <BrandMark className="size-6" />
          <span className="hidden text-sm font-semibold tracking-tight text-fg sm:inline">
            Raven
          </span>
        </NavLink>

        {/* The spacer, not a `<nav>`. There are no top-level nav links left:
            the workspace *is* home, and everything else is in the menu. */}
        <div className="flex-1" />

        <WorkspaceSwitcher />

        {/* Renders nothing outside a workspace route — the preference is per
            (member, workspace). */}
        <EnvironmentPicker />

        {/* ⚠️ Its own control rather than an item inside the account menu: the
            theme is per browser, not per account, so it is not an account
            setting — and it is changed far more often than anything under a
            user's own name should be buried. */}
        <ThemeButton />
        <UserMenu />
      </div>
    </header>
  )
}
