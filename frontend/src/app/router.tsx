import { createBrowserRouter, Navigate } from 'react-router'
import RegisterPage from '../features/auth/RegisterPage'
import { LoginPage } from '../features/auth/LoginPage'
import { RequireAuth } from '../features/auth/RequireAuth'
import { EmptyEditorState } from '../features/requests/EmptyEditorState'
import { RequestEditor } from '../features/requests/RequestEditor'
import { SessionsPage } from '../features/sessions/SessionsPage'
import { TasksPage } from '../features/tasks/TasksPage'
import { WorkspaceRedirect } from '../features/workspaces/WorkspaceRedirect'
import { AppShell } from './AppShell'
import { WorkbenchShell } from './WorkbenchShell'

/**
 * Router only — no `loader`, `action` or `fetcher`. Loaders would need the
 * access token out of Redux, which would drag the store into route modules;
 * data stays in RTK Query hooks.
 *
 * Two shells sit inside the one `RequireAuth`: the workbench, whose panes
 * scroll independently, and the original centred `AppShell` that `/tasks` and
 * `/sessions` still use. `/login` and `/register` stay outside it, unchanged.
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
        element: <WorkbenchShell />,
        children: [
          { path: 'w/:workspaceId', element: <EmptyEditorState /> },
          {
            path: 'w/:workspaceId/requests/:requestId',
            element: <RequestEditor />,
          },
        ],
      },
      {
        element: <AppShell />,
        children: [
          { path: 'tasks', element: <TasksPage /> },
          { path: 'sessions', element: <SessionsPage /> },
        ],
      },
      // Up a level from where it used to live, and pointing at `/` rather than
      // `/tasks`: it now covers two shells, and a mistyped URL should land on
      // the workspace rather than on the page being deprecated.
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
