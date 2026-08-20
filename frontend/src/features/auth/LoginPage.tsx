import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { baseApi } from "../../app/baseApi";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { errorMessage, fieldErrors, toApiError } from "../../lib/api-error";
import { ThemeMenu } from "../theme/ThemeMenu";
import { useLoginMutation } from "./authApi";
import { selectIsAuthenticated } from "./authSlice";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [login, { isLoading, error, reset }] = useLoginMutation();
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  const fields = fieldErrors(error);
  const apiError = toApiError(error);
  // Defaults to "/", the workbench, which `WorkspaceRedirect` resolves to
  // the user's workspace.
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  /**
   * The previous attempt's error describes credentials the user has now
   * changed, so leaving it up while they retype is stale and reads as though
   * the new value was rejected too.
   */
  function edit(set: (value: string) => void, value: string) {
    set(value);
    if (error) reset();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    // Drop user A's cached data before user B signs in. This belongs here and
    // not in logout's onQueryStarted: at logout time the workbench still has a
    // live subscriber, so a reset there refetches immediately, 401s, and then
    // refreshes against a cookie the server has just cleared. On /login
    // nothing authenticated is mounted, which is exactly when this matters.
    dispatch(baseApi.util.resetApiState());

    try {
      await login({ email: email.trim(), password }).unwrap();
      // The password does not outlive the request that used it.
      setPassword("");
      void navigate(from, { replace: true });
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
  if (isAuthenticated) return <Navigate to={from} replace />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-fg">Sign in</h1>
          <p className="text-sm text-fg-subtle">
            Postman clone — use your account to continue
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          // The browser's native bubble for `type="email"` speaks in a
          // different voice from the API's field errors, and cannot be styled
          // or read by the same assistive tech. One error channel, not two.
          noValidate
          className="rounded-lg border border-line bg-surface p-4 shadow-sm glass"
        >
          <div className="flex flex-col gap-3">
            <div>
              <label
                htmlFor="email"
                className="mb-1 block text-sm font-medium text-fg-muted"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => edit(setEmail, e.target.value)}
                aria-invalid={Boolean(fields.email)}
                className={`w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 ${
                  fields.email
                    ? "border-danger focus:ring-focus-danger"
                    : "border-line-strong focus:border-accent focus:ring-focus"
                }`}
              />
              {fields.email && (
                <p className="mt-1 text-xs text-danger">{fields.email}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1 block text-sm font-medium text-fg-muted"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => edit(setPassword, e.target.value)}
                  aria-invalid={Boolean(fields.password)}
                  className={`w-full rounded-md border py-2 pl-3 pr-16 text-sm outline-none focus:ring-2 ${
                    fields.password
                      ? "border-danger focus:ring-focus-danger"
                      : "border-line-strong focus:border-accent focus:ring-focus"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  aria-controls="password"
                  aria-pressed={showPassword}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 rounded-r-md px-3 text-xs font-medium text-fg-subtle transition hover:text-fg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              {fields.password && (
                <p className="mt-1 text-xs text-danger">{fields.password}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading || !email.trim() || !password}
              className="h-[38px] rounded-md bg-accent px-4 text-sm font-medium text-on-accent transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-disabled disabled:text-fg-disabled"
            >
              {isLoading ? "Signing in…" : "Sign in"}
            </button>

            <p className="text-sm text-fg-subtle">
              Don't have an account?{" "}
              <Link
                to="/register"
                state={{ from }}
                className="font-medium text-accent hover:text-accent-hover"
              >
                Sign up
              </Link>
            </p>
          </div>

          {/*
            `role="alert"`: the message renders below the submit button, which
            a screen-reader user has no reason to move back to. Without this a
            rejected sign-in is silent.
          */}
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {errorMessage(
                error,
                "Could not reach the server. Check your connection.",
              )}
              {apiError && (
                <span className="ml-2 font-mono text-xs text-fg-faint">
                  {apiError.code} · {apiError.requestId.slice(0, 8)}
                </span>
              )}
            </p>
          )}
        </form>

        {/*
          The theme control is reachable from every screen, not just the ones
          behind the header. A preference set on a machine and then hidden
          until sign-in is the same as not having one.
        */}
        <div className="mt-4 flex justify-center">
          <ThemeMenu />
        </div>
      </div>
    </div>
  );
}
