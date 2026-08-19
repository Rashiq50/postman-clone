import { Outlet } from 'react-router'
import { AppHeader } from '../features/auth/AppHeader'

export function AppShell() {
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Outlet />
      </main>
    </div>
  )
}
