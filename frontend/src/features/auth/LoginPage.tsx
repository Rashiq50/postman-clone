import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { baseApi } from '../../app/baseApi'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { errorMessage, fieldErrors, toApiError } from '../../lib/api-error'
import { AuthCard, AuthField, FormError, SubmitButton } from './AuthField'
import { AuthLayout } from './AuthLayout'
import { useLoginMutation } from './authApi'
import { selectIsAuthenticated } from './authSlice'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [login, { isLoading, error, reset }] = useLoginMutation()
  const isAuthenticated = useAppSelector(selectIsAuthenticated)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const location = useLocation()

  const fields = fieldErrors(error)
  const apiError = toApiError(error)
  // Defaults to "/", the workbench, which `WorkspaceRedirect` resolves to
  // the user's workspace.
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  /**
   * The previous attempt's error describes credentials the user has now
   * changed, so leaving it up while they retype is stale and reads as though
   * the new value was rejected too.
   */
  function edit(set: (value: string) => void, value: string) {
    set(value)
    if (error) reset()
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    // Drop user A's cached data before user B signs in. This belongs here and
    // not in logout's onQueryStarted: at logout time the workbench still has a
    // live subscriber, so a reset there refetches immediately, 401s, and then
    // refreshes against a cookie the server has just cleared. On /login
    // nothing authenticated is mounted, which is exactly when this matters.
    dispatch(baseApi.util.resetApiState())

    try {
      await login({ email: email.trim(), password }).unwrap()
      // The password does not outlive the request that used it.
      setPassword('')
      void navigate(from, { replace: true })
    } catch {
      // Surfaced through `error` below.
    }
  }

  /**
   * `from`, not a hard-coded route: this branch and the imperative
   * `navigate(from)` above must agree. They race — `credentialsReceived` is
   * dispatched inside `onQueryStarted`, so a re-render can be queued before
   * the handler resumes — and if they disagree, a user who deep-linked to
   * `/sessions` lands wherever the race happened to settle.
   */
  if (isAuthenticated) return <Navigate to={from} replace />

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Use your account to continue."
      footer={
        <>
          Don&apos;t have an account?{' '}
          <Link
            to="/register"
            state={{ from }}
            className="font-medium text-accent transition hover:text-accent-hover"
          >
            Sign up
          </Link>
        </>
      }
    >
      <AuthCard onSubmit={handleSubmit}>
        <AuthField
          id="email"
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(value) => edit(setEmail, value)}
          error={fields.email}
        />

        <AuthField
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(value) => edit(setPassword, value)}
          error={fields.password}
        />

        <SubmitButton
          busy={isLoading}
          disabled={!email.trim() || !password}
          busyLabel="Signing in…"
        >
          Sign in
        </SubmitButton>

        {error && (
          <FormError
            message={errorMessage(
              error,
              'Could not reach the server. Check your connection.',
            )}
            code={apiError ?? undefined}
          />
        )}
      </AuthCard>
    </AuthLayout>
  )
}
