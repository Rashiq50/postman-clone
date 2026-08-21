import {
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  passwordProblem,
} from '@raven/contracts'
import { useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { baseApi } from '../../app/baseApi'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { errorMessage, fieldErrors, toApiError } from '../../lib/api-error'
import { Field, FormError, SubmitButton } from '../../components/ui/Field'
import { AuthCard } from './AuthCard'
import { AuthLayout } from './AuthLayout'
import { useRegisterMutation } from './authApi'
import { selectIsAuthenticated } from './authSlice'

type FieldName = 'name' | 'email' | 'password' | 'confirmPassword'

interface Values {
  name: string
  email: string
  password: string
  confirmPassword: string
}

/**
 * The client-side half of validation. The password rule is imported rather
 * than restated: `RegisterDto` runs the same `passwordProblem` server-side, so
 * the form can never accept something the API will reject, or vice versa.
 *
 * None of this is a security control — it exists so the user learns about a
 * typo without a round trip. The API validates every one of these again.
 */
function validate(values: Values): Partial<Record<FieldName, string>> {
  const problems: Partial<Record<FieldName, string>> = {}

  const name = values.name.trim()
  if (!name) problems.name = 'Name is required'
  else if (name.length > NAME_MAX_LENGTH)
    problems.name = `Name must be at most ${NAME_MAX_LENGTH} characters`

  const email = values.email.trim()
  if (!email) problems.email = 'Email is required'
  // Deliberately loose: the server's `@IsEmail()` is the real check, and a
  // strict regex here only ever rejects addresses that are actually valid.
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    problems.email = 'Enter a valid email address'
  else if (email.length > EMAIL_MAX_LENGTH)
    problems.email = `Email must be at most ${EMAIL_MAX_LENGTH} characters`

  if (!values.password) problems.password = 'Password is required'
  else problems.password = passwordProblem(values.password) ?? undefined
  if (!problems.password) delete problems.password

  if (!values.confirmPassword)
    problems.confirmPassword = 'Confirm your password'
  else if (values.confirmPassword !== values.password)
    problems.confirmPassword = 'Passwords do not match'

  return problems
}

const FIELD_ORDER: FieldName[] = [
  'name',
  'email',
  'password',
  'confirmPassword',
]

const RegisterPage = () => {
  const [values, setValues] = useState<Values>({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>(
    {},
  )

  const [register, { isLoading, error, reset }] = useRegisterMutation()
  const isAuthenticated = useAppSelector(selectIsAuthenticated)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const location = useLocation()

  const inputs = useRef<Partial<Record<FieldName, HTMLInputElement | null>>>({})

  const apiError = toApiError(error)
  const serverFields = fieldErrors(error)
  const clientProblems = validate(values)
  // Defaults to "/", the workbench, which `WorkspaceRedirect` resolves to
  // the user's workspace.
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  // 409 EMAIL_TAKEN carries no `details`, so it is attached to the field it is
  // actually about instead of only appearing in the summary at the bottom.
  const emailTaken = apiError?.code === 'EMAIL_TAKEN'

  /**
   * A field shows a problem once the user has left it (or tried to submit),
   * never while they are still typing their first character into it. The
   * server's own field errors are shown unconditionally — the user did submit.
   */
  function problemFor(field: FieldName): string | undefined {
    if (field === 'email' && emailTaken) return apiError?.message
    if (serverFields[field]) return serverFields[field]
    return touched[field] ? clientProblems[field] : undefined
  }

  function update(field: FieldName, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }))
    // The previous attempt's error describes a body the user has now changed,
    // so keeping it on screen would be stale and confusing.
    if (error) reset()
  }

  function markTouched(field: FieldName) {
    setTouched((prev) => ({ ...prev, [field]: true }))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (isLoading) return

    setTouched({
      name: true,
      email: true,
      password: true,
      confirmPassword: true,
    })

    const problems = validate(values)
    const firstInvalid = FIELD_ORDER.find((field) => problems[field])
    if (firstInvalid) {
      // Move focus to the problem rather than leaving a screen-reader user to
      // hunt for what changed.
      inputs.current[firstInvalid]?.focus()
      return
    }

    // Drop any cache belonging to a previously signed-in user before this one
    // takes over the session — same reasoning as `LoginPage`, and registering
    // while a session is live is a real path (the API revokes the old one).
    dispatch(baseApi.util.resetApiState())

    try {
      await register({
        name: values.name.trim(),
        email: values.email.trim(),
        password: values.password,
      }).unwrap()

      // The password never outlives the request that used it.
      setValues((prev) => ({ ...prev, password: '', confirmPassword: '' }))
      void navigate(from, { replace: true })
    } catch {
      // Surfaced through `error` below.
    }
  }

  // `from`, not a hard-coded route — this branch and the `navigate(from)`
  // in the submit handler race, and must not disagree about the destination.
  if (isAuthenticated) return <Navigate to={from} replace />

  return (
    <AuthLayout
      title="Create your account"
      subtitle="A workspace is provisioned for you on sign-up."
      footer={
        <>
          Already have an account?{' '}
          <Link
            to="/login"
            state={{ from }}
            className="font-medium text-accent transition hover:text-accent-hover"
          >
            Sign in
          </Link>
        </>
      }
    >
      <AuthCard onSubmit={handleSubmit}>
        <Field
          id="name"
          label="Name"
          type="text"
          autoComplete="name"
          maxLength={NAME_MAX_LENGTH}
          value={values.name}
          onChange={(value) => update('name', value)}
          onBlur={() => markTouched('name')}
          error={problemFor('name')}
          inputRef={(el) => {
            inputs.current.name = el
          }}
        />

        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="username"
          maxLength={EMAIL_MAX_LENGTH}
          value={values.email}
          onChange={(value) => update('email', value)}
          onBlur={() => markTouched('email')}
          error={problemFor('email')}
          errorSuffix={
            emailTaken ? (
              <>
                {' '}
                <Link
                  to="/login"
                  state={{ from }}
                  className="font-medium underline"
                >
                  Sign in instead
                </Link>
              </>
            ) : undefined
          }
          inputRef={(el) => {
            inputs.current.email = el
          }}
        />

        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
          value={values.password}
          onChange={(value) => update('password', value)}
          onBlur={() => markTouched('password')}
          error={problemFor('password')}
          hint="At least 8 characters, including a letter and a number."
          inputRef={(el) => {
            inputs.current.password = el
          }}
        />

        <Field
          id="confirm-password"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
          value={values.confirmPassword}
          onChange={(value) => update('confirmPassword', value)}
          onBlur={() => markTouched('confirmPassword')}
          error={problemFor('confirmPassword')}
          revealLabel={{
            show: 'Show password confirmation',
            hide: 'Hide password confirmation',
          }}
          inputRef={(el) => {
            inputs.current.confirmPassword = el
          }}
        />

        <SubmitButton busy={isLoading} busyLabel="Creating account…">
          Create account
        </SubmitButton>

        {/*
          `aria-live` so the in-flight state is announced. Field-level problems
          are not repeated here — `FormError` below is the request's own
          failure (a 409, a 500, a dead connection).
        */}
        <p role="status" aria-live="polite" className="sr-only">
          {isLoading ? 'Creating your account' : ''}
        </p>

        {error && !emailTaken && (
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

export default RegisterPage
