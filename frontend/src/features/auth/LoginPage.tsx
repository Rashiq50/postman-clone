import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { baseApi } from '../../app/baseApi'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { errorMessage, fieldErrors, toApiError } from '../../lib/api-error'
import { useLoginMutation } from './authApi'
import { selectIsAuthenticated } from './authSlice'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [login, { isLoading, error }] = useLoginMutation()
  const isAuthenticated = useAppSelector(selectIsAuthenticated)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const location = useLocation()

  const fields = fieldErrors(error)
  const apiError = toApiError(error)
  const from = (location.state as { from?: string } | null)?.from ?? '/tasks'

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    // Drop user A's cached data before user B signs in. This belongs here and
    // not in logout's onQueryStarted: at logout time the task list still has a
    // live subscriber, so a reset there refetches immediately, 401s, and then
    // refreshes against a cookie the server has just cleared. On /login
    // nothing authenticated is mounted, which is exactly when this matters.
    dispatch(baseApi.util.resetApiState())

    try {
      await login({ email: email.trim(), password }).unwrap()
      void navigate(from, { replace: true })
    } catch {
      // Surfaced through `error` below.
    }
  }

  if (isAuthenticated) return <Navigate to="/tasks" replace />

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">Sign in</h1>
          <p className="text-sm text-slate-500">
            Postman clone — use your account to continue
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="flex flex-col gap-3">
            <div>
              <label
                htmlFor="email"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={Boolean(fields.email)}
                className={`w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 ${
                  fields.email
                    ? 'border-red-400 focus:border-red-500 focus:ring-red-200'
                    : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-200'
                }`}
              />
              {fields.email && (
                <p className="mt-1 text-xs text-red-600">{fields.email}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={Boolean(fields.password)}
                className={`w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 ${
                  fields.password
                    ? 'border-red-400 focus:border-red-500 focus:ring-red-200'
                    : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-200'
                }`}
              />
              {fields.password && (
                <p className="mt-1 text-xs text-red-600">{fields.password}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading || !email.trim() || !password}
              className="h-[38px] rounded-md bg-indigo-600 px-4 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isLoading ? 'Signing in…' : 'Sign in'}
            </button>
          </div>

          {error && (
            <p className="mt-2 text-sm text-red-600">
              {errorMessage(
                error,
                'Could not reach the server. Check your connection.',
              )}
              {apiError && (
                <span className="ml-2 font-mono text-xs text-slate-400">
                  {apiError.code} · {apiError.requestId.slice(0, 8)}
                </span>
              )}
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
