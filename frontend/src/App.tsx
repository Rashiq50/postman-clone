import { RouterProvider } from 'react-router'
import { useAppSelector } from './app/hooks'
import { router } from './app/router'
import { selectIsBootstrapped } from './features/auth/authSlice'

function BootSplash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <p className="text-sm text-fg-subtle">Loading…</p>
    </div>
  )
}

function App() {
  const bootstrapped = useAppSelector(selectIsBootstrapped)

  // The router is withheld until the boot-time silent refresh has settled, so
  // a deep link never flashes /login on its way to its real destination. The
  // URL is untouched while the splash is up, so nothing is lost.
  if (!bootstrapped) return <BootSplash />

  return <RouterProvider router={router} />
}

export default App
