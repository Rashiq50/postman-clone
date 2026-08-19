import {
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  passwordProblem,
} from "@postman-clone/contracts";
import { useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { baseApi } from "../../app/baseApi";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { errorMessage, fieldErrors, toApiError } from "../../lib/api-error";
import { useRegisterMutation } from "./authApi";
import { selectIsAuthenticated } from "./authSlice";

type FieldName = "name" | "email" | "password" | "confirmPassword";

interface Values {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
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
  const problems: Partial<Record<FieldName, string>> = {};

  const name = values.name.trim();
  if (!name) problems.name = "Name is required";
  else if (name.length > NAME_MAX_LENGTH)
    problems.name = `Name must be at most ${NAME_MAX_LENGTH} characters`;

  const email = values.email.trim();
  if (!email) problems.email = "Email is required";
  // Deliberately loose: the server's `@IsEmail()` is the real check, and a
  // strict regex here only ever rejects addresses that are actually valid.
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    problems.email = "Enter a valid email address";
  else if (email.length > EMAIL_MAX_LENGTH)
    problems.email = `Email must be at most ${EMAIL_MAX_LENGTH} characters`;

  if (!values.password) problems.password = "Password is required";
  else problems.password = passwordProblem(values.password) ?? undefined;
  if (!problems.password) delete problems.password;

  if (!values.confirmPassword)
    problems.confirmPassword = "Confirm your password";
  else if (values.confirmPassword !== values.password)
    problems.confirmPassword = "Passwords do not match";

  return problems;
}

const FIELD_ORDER: FieldName[] = ["name", "email", "password", "confirmPassword"];

const inputClass = (invalid: boolean, extra = "") =>
  `w-full rounded-md border text-sm outline-none focus:ring-2 ${extra} ${
    invalid
      ? "border-red-400 focus:border-red-500 focus:ring-red-200"
      : "border-slate-300 focus:border-indigo-500 focus:ring-indigo-200"
  }`;

const RegisterPage = () => {
  const [values, setValues] = useState<Values>({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>(
    {},
  );
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [register, { isLoading, error, reset }] = useRegisterMutation();
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  const inputs = useRef<Partial<Record<FieldName, HTMLInputElement | null>>>({});

  const apiError = toApiError(error);
  const serverFields = fieldErrors(error);
  const clientProblems = validate(values);
  const from = (location.state as { from?: string } | null)?.from ?? "/tasks";

  // 409 EMAIL_TAKEN carries no `details`, so it is attached to the field it is
  // actually about instead of only appearing in the summary at the bottom.
  const emailTaken = apiError?.code === "EMAIL_TAKEN";

  /**
   * A field shows a problem once the user has left it (or tried to submit),
   * never while they are still typing their first character into it. The
   * server's own field errors are shown unconditionally — the user did submit.
   */
  function problemFor(field: FieldName): string | undefined {
    if (field === "email" && emailTaken) return apiError?.message;
    if (serverFields[field]) return serverFields[field];
    return touched[field] ? clientProblems[field] : undefined;
  }

  function update(field: FieldName, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    // The previous attempt's error describes a body the user has now changed,
    // so keeping it on screen would be stale and confusing.
    if (error) reset();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isLoading) return;

    setTouched({ name: true, email: true, password: true, confirmPassword: true });

    const problems = validate(values);
    const firstInvalid = FIELD_ORDER.find((field) => problems[field]);
    if (firstInvalid) {
      // Move focus to the problem rather than leaving a screen-reader user to
      // hunt for what changed.
      inputs.current[firstInvalid]?.focus();
      return;
    }

    // Drop any cache belonging to a previously signed-in user before this one
    // takes over the session — same reasoning as `LoginPage`, and registering
    // while a session is live is a real path (the API revokes the old one).
    dispatch(baseApi.util.resetApiState());

    try {
      await register({
        name: values.name.trim(),
        email: values.email.trim(),
        password: values.password,
      }).unwrap();

      // The password never outlives the request that used it.
      setValues((prev) => ({ ...prev, password: "", confirmPassword: "" }));
      void navigate(from, { replace: true });
    } catch {
      // Surfaced through `error` below.
    }
  }

  // `from`, not a hard-coded `/tasks` — this branch and the `navigate(from)`
  // in the submit handler race, and must not disagree about the destination.
  if (isAuthenticated) return <Navigate to={from} replace />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">Sign up</h1>
          <p className="text-sm text-slate-500">
            Postman clone — create an account to continue
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="flex flex-col gap-3">
            <div>
              <label
                htmlFor="name"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Name
              </label>
              <input
                id="name"
                ref={(el) => {
                  inputs.current.name = el;
                }}
                type="text"
                autoComplete="name"
                maxLength={NAME_MAX_LENGTH}
                value={values.name}
                onChange={(e) => update("name", e.target.value)}
                onBlur={() => setTouched((prev) => ({ ...prev, name: true }))}
                aria-invalid={Boolean(problemFor("name"))}
                aria-describedby={problemFor("name") ? "name-error" : undefined}
                className={inputClass(Boolean(problemFor("name")), "px-3 py-2")}
              />
              {problemFor("name") && (
                <p id="name-error" className="mt-1 text-xs text-red-600">
                  {problemFor("name")}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="email"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Email
              </label>
              <input
                id="email"
                ref={(el) => {
                  inputs.current.email = el;
                }}
                type="email"
                autoComplete="username"
                maxLength={EMAIL_MAX_LENGTH}
                value={values.email}
                onChange={(e) => update("email", e.target.value)}
                onBlur={() => setTouched((prev) => ({ ...prev, email: true }))}
                aria-invalid={Boolean(problemFor("email"))}
                aria-describedby={
                  problemFor("email") ? "email-error" : undefined
                }
                className={inputClass(Boolean(problemFor("email")), "px-3 py-2")}
              />
              {problemFor("email") && (
                <p id="email-error" className="mt-1 text-xs text-red-600">
                  {problemFor("email")}
                  {emailTaken && (
                    <>
                      {" "}
                      <Link
                        to="/login"
                        state={{ from }}
                        className="font-medium underline"
                      >
                        Sign in instead
                      </Link>
                    </>
                  )}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  ref={(el) => {
                    inputs.current.password = el;
                  }}
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  maxLength={PASSWORD_MAX_LENGTH}
                  value={values.password}
                  onChange={(e) => update("password", e.target.value)}
                  onBlur={() =>
                    setTouched((prev) => ({ ...prev, password: true }))
                  }
                  aria-invalid={Boolean(problemFor("password"))}
                  aria-describedby={
                    problemFor("password") ? "password-error" : "password-hint"
                  }
                  className={inputClass(
                    Boolean(problemFor("password")),
                    "py-2 pl-3 pr-16",
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  aria-controls="password"
                  aria-pressed={showPassword}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 rounded-r-md px-3 text-xs font-medium text-slate-500 transition hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              {problemFor("password") ? (
                <p id="password-error" className="mt-1 text-xs text-red-600">
                  {problemFor("password")}
                </p>
              ) : (
                <p id="password-hint" className="mt-1 text-xs text-slate-500">
                  At least 8 characters, including a letter and a number.
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="confirm-password"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Confirm password
              </label>
              <div className="relative">
                <input
                  id="confirm-password"
                  ref={(el) => {
                    inputs.current.confirmPassword = el;
                  }}
                  type={showConfirmPassword ? "text" : "password"}
                  autoComplete="new-password"
                  maxLength={PASSWORD_MAX_LENGTH}
                  value={values.confirmPassword}
                  onChange={(e) => update("confirmPassword", e.target.value)}
                  onBlur={() =>
                    setTouched((prev) => ({ ...prev, confirmPassword: true }))
                  }
                  aria-invalid={Boolean(problemFor("confirmPassword"))}
                  aria-describedby={
                    problemFor("confirmPassword")
                      ? "confirm-password-error"
                      : undefined
                  }
                  className={inputClass(
                    Boolean(problemFor("confirmPassword")),
                    "py-2 pl-3 pr-16",
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((shown) => !shown)}
                  aria-controls="confirm-password"
                  aria-pressed={showConfirmPassword}
                  aria-label={
                    showConfirmPassword
                      ? "Hide password confirmation"
                      : "Show password confirmation"
                  }
                  className="absolute inset-y-0 right-0 rounded-r-md px-3 text-xs font-medium text-slate-500 transition hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                >
                  {showConfirmPassword ? "Hide" : "Show"}
                </button>
              </div>
              {problemFor("confirmPassword") && (
                <p
                  id="confirm-password-error"
                  className="mt-1 text-xs text-red-600"
                >
                  {problemFor("confirmPassword")}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="h-[38px] rounded-md bg-indigo-600 px-4 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isLoading ? "Creating account…" : "Sign up"}
            </button>

            <p className="text-sm text-slate-500">
              Already have an account?{" "}
              <Link
                to="/login"
                state={{ from }}
                className="font-medium text-indigo-600 hover:text-indigo-700"
              >
                Sign in
              </Link>
            </p>
          </div>

          {/*
            `aria-live` so a failure is announced: the summary appears below the
            submit button, which a screen-reader user has no reason to revisit.
            Field-level problems are not repeated here — this is the request's
            own failure (a 409, a 500, a dead connection).
          */}
          <p role="status" aria-live="polite" className="sr-only">
            {isLoading ? "Creating your account" : ""}
          </p>

          {error && !emailTaken && (
            <p className="mt-2 text-sm text-red-600" role="alert">
              {errorMessage(
                error,
                "Could not reach the server. Check your connection.",
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
  );
};

export default RegisterPage;
