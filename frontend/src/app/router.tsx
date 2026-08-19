import { createBrowserRouter, Navigate } from 'react-router'
import { LoginPage } from '../features/auth/LoginPage'
import { RequireAuth } from '../features/auth/RequireAuth'
import { SessionsPage } from '../features/sessions/SessionsPage'
import { TasksPage } from '../features/tasks/TasksPage'
import { AppShell } from './AppShell'

/**
 * Router only — no `loader`, `action` or `fetcher`. Loaders would need the
 * access token out of Redux, which would drag the store into route modules;
 * data stays in RTK Query hooks, the same as `TaskList` and `TaskForm`.
 *
 * A production deploy needs an SPA fallback (every path → index.html). Vite's
 * dev server and `vite preview` do this already.
 */
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/tasks" replace /> },
          { path: 'tasks', element: <TasksPage /> },
          { path: 'sessions', element: <SessionsPage /> },
          { path: '*', element: <Navigate to="/tasks" replace /> },
        ],
      },
    ],
  },
])

