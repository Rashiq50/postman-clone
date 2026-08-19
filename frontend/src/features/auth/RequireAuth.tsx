import { Navigate, Outlet, useLocation } from 'react-router'
import { useAppSelector } from '../../app/hooks'
import { selectIsAuthenticated } from './authSlice'

/**
 * Layout route guarding everything that needs a session.
 *
 * There is deliberately no loading state here: the router is only rendered
 * once `bootstrapped` is true (see `App.tsx`), so by the time this runs the
 * silent refresh has already settled and "no access token" means "anonymous",
 * not "not decided yet".
 */
export function RequireAuth() {
  const isAuthenticated = useAppSelector(selectIsAuthenticated)
  const location = useLocation()

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        state={{ from: location.pathname + location.search }}
        replace
      />
    )
  }

  return <Outlet />
}
