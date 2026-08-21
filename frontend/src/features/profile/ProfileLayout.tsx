import { NavLink, Outlet } from 'react-router'

/**
 * The shell for `/profile` and `/profile/sessions`.
 *
 * ⚠️ The sub-nav is `NavLink`s, not local tab state, because these are two
 * **locations**: Back must return from Sessions to Account, and a link to a
 * user's sessions has to be a URL that survives a reload. That is the opposite
 * of the call `RequestEditor` makes about its Params/Body tabs, and for the
 * opposite reason — there, Back closing a tab instead of leaving the request is
 * not what Back means.
 *
 * `end` on the Account link: without it the parent route matches on
 * `/profile/sessions` too and both links light up at once.
 */
const tabClass = ({ isActive }: { isActive: boolean }) =>
  `-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
    isActive
      ? 'border-accent text-accent'
      : 'border-transparent text-fg-subtle hover:text-fg'
  }`

export function ProfileLayout() {
  return (
    <>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">
          Profile
        </h1>
        <p className="mt-1 text-sm text-fg-subtle">
          Your account details and the devices signed in to it.
        </p>
      </header>

      <nav className="mb-6 flex gap-1 border-b border-line">
        <NavLink to="/profile" end className={tabClass}>
          Account
        </NavLink>
        <NavLink to="/profile/sessions" className={tabClass}>
          Sessions
        </NavLink>
      </nav>

      <Outlet />
    </>
  )
}
