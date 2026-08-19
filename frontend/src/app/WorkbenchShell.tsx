import { Outlet } from 'react-router'
import { AppHeader } from '../features/auth/AppHeader'
import { Sidebar } from '../features/tree/Sidebar'

/**
 * A second shell rather than a branch inside `AppShell`.
 *
 * `AppShell` is `min-h-screen` with a centred `max-w-3xl` column that scrolls
 * with the page. The workbench is the opposite layout contract: `h-screen
 * overflow-hidden`, a fixed sidebar, and panes that scroll independently.
 * Those are two different components, not one component with a flag.
 */
export function WorkbenchShell() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
      <AppHeader wide />
      {/*
        ⚠️ `min-h-0` on both the grid and <main> is load-bearing. A grid or
        flex child defaults to `min-height: auto`, which means "at least as tall
        as my content" — so without it the panes grow to fit and the whole page
        scrolls instead of the panes. It reads as a CSS mistake rather than the
        default it actually is.
      */}
      <div className="grid min-h-0 flex-1 grid-cols-[280px_1fr]">
        <Sidebar />
        <main className="min-h-0 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
