import { createBrowserRouter, Navigate } from 'react-router'
import RegisterPage from '../features/auth/RegisterPage'
import { LoginPage } from '../features/auth/LoginPage'
import { RequireAuth } from '../features/auth/RequireAuth'
import { EmptyEditorState } from '../features/requests/EmptyEditorState'
import { RequestEditor } from '../features/requests/RequestEditor'
import { ProfileLayout } from '../features/profile/ProfileLayout'
import { ProfilePage } from '../features/profile/ProfilePage'
import { SessionsPage } from '../features/sessions/SessionsPage'
import { WorkspaceGuard } from '../features/workspaces/WorkspaceGuard'
import { WorkspaceRedirect } from '../features/workspaces/WorkspaceRedirect'
import { AppShell } from './AppShell'
import { WorkbenchShell } from './WorkbenchShell'

/**
 * Router only — no `loader`, `action` or `fetcher`. Loaders would need the
 * access token out of Redux, which would drag the store into route modules;
 * data stays in RTK Query hooks.
 *
 * Two shells sit inside the one `RequireAuth`: the workbench, whose panes
 * scroll independently, and the centred `AppShell` that `/profile` uses.
 * `/login` and `/register` stay outside it, unchanged.
 *
 * The workspace id is a **route param**, not Redux state — see
 * `WorkspaceRedirect` for why that is a correctness requirement here and not a
 * preference.
 *
 * A production deploy needs an SPA fallback (every path → index.html). Vite's
 * dev server and `vite preview` do this already.
 */
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  {
    element: <RequireAuth />,
    children: [
      { index: true, element: <WorkspaceRedirect /> },
      {
        // `w/:workspaceId` is matched once, by the guard, and the shell nests
        // inside it: the id must be checked against the user's own workspaces
        // before `WorkbenchShell` mounts a sidebar against it. See
        // `WorkspaceGuard` for the sign-out/sign-in path that makes a foreign
        // id land here in the first place.
        path: 'w/:workspaceId',
        element: <WorkspaceGuard />,
        children: [
          {
            element: <WorkbenchShell />,
            children: [
              { index: true, element: <EmptyEditorState /> },
              {
                path: 'requests/:requestId',
                element: <RequestEditor />,
              },
            ],
          },
        ],
      },
      {
        element: <AppShell />,
        children: [
          {
            // `/profile` and `/profile/sessions`. Sessions is a sub-page of the
            // account rather than a peer of the workspace: it is a list of
            // *your devices*, which is a profile concern, and the top-level nav
            // it used to occupy is gone.
            path: 'profile',
            element: <ProfileLayout />,
            children: [
              { index: true, element: <ProfilePage /> },
              { path: 'sessions', element: <SessionsPage /> },
            ],
          },
          // ⚠️ The old path is kept as a redirect, not deleted. It is the one
          // route in this app a user is likely to have bookmarked, and the
          // catch-all below would otherwise silently land them on the workspace
          // with no hint that their link moved.
          {
            path: 'sessions',
            element: <Navigate to="/profile/sessions" replace />,
          },
        ],
      },
      // Sits above both shells and points at `/`, so a mistyped URL lands on
      // the workspace rather than on a 404.
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
