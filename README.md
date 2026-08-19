# Postman Clone

NestJS backend, React frontend, and a shared contracts package. Package manager: **yarn**.

```
backend/            NestJS + TypeORM + PostgreSQL
frontend/           React + Redux Toolkit + TypeScript + Tailwind CSS (Vite)
packages/contracts/ Wire format shared by both — one definition, both sides
```

## Prerequisites

- Node.js 20+
- Yarn 1.x
- PostgreSQL 18 running locally with a `postman_clone` database

```bash
psql -U postgres -c "CREATE DATABASE postman_clone"
```

## Quick start — `dev.sh`

```bash
cp backend/.env.example backend/.env   # then set DB_PASSWORD
./dev.sh                               # install, build contracts, migrate, start, status
```

```
SERVICE    STATUS     PID      PORT   URL                                   UPTIME
backend    running    25636    3000   http://localhost:3000/api/v1/tasks    5s
frontend   running    6344     5173   http://localhost:5173                 2s
```

| Command | Does |
| --- | --- |
| `./dev.sh` | install → build contracts → migrate → start both → status |
| `./dev.sh install` | `yarn install` in each repo, then rebuild + sync contracts |
| `./dev.sh contracts` | rebuild the shared contracts package only |
| `./dev.sh migrate` | run pending migrations |
| `./dev.sh start\|stop\|restart [svc]` | supervise services |
| `./dev.sh status` | the table above |
| `./dev.sh logs [svc] [-f]` | tail logs from `.dev/logs/` |

`svc` is `backend` or `frontend`; omit it to act on both. Liveness comes from what is
actually listening on the port, not a pidfile, and stopping kills the whole process tree.

## The shared contracts package

`packages/contracts` holds the wire format: `Task`, `TaskStatus`, the pagination envelope,
the API prefix and version. Both sides import it, so the shape cannot drift silently —
`TaskResponseDto implements Task` on the backend, which means **a mismatch fails the build**
rather than surfacing as a runtime bug in the browser.

It is built and **copied** into each app's `node_modules`, not symlinked:

> This project lives on a volume where NTFS reparse points fail (`ERROR_FILE_CORRUPT` on
> every junction and symlink, drive-wide — reproducible with `New-Item -ItemType Junction`
> anywhere on `H:`). Yarn workspaces and `npm link` are both symlink-based, so neither can
> work here. A copied build is byte-for-byte what a published dependency looks like to Node,
> tsc and Vite, so nothing in the application code depends on this choice. If the drive is
> ever repaired (`chkdsk H: /f`) you can switch to real workspaces without touching a single
> import.

**Re-run `./dev.sh contracts` after editing `packages/contracts/src`, and after any
`yarn install`** — yarn prunes packages it does not find in a `package.json`.

## Backend

```bash
cd backend
yarn start:dev     # http://localhost:3000/api/v1
```

### Configuration

Every variable is declared in `src/config/env.validation.ts` and validated at boot. A
missing one stops the process with all problems listed at once, rather than turning up as
`undefined` mid-request — which for a signing secret is an auth bypass, not a crash.

### Migrations

There is deliberately no `synchronize`. It is `false` in every environment.

```bash
yarn migration:generate src/database/migrations/AddSomething
yarn migration:run
yarn migration:revert
yarn migration:show
```

The CLI and the running app both build their connection options from
`src/config/database.config.ts`, so migrations are always generated against the same schema
the app talks to. Migrations run explicitly, never on boot, so a failed migration fails a
deploy visibly instead of half-starting the app.

### API

Routes are `/{prefix}/v{version}/…` — currently `/api/v1`. URI versioning is on, so a
breaking change ships as `v2` next to `v1` instead of mutating an endpoint clients depend on.

| Method | Route | Body | Response |
| --- | --- | --- | --- |
| `POST` | `/api/v1/auth/register` | `{ email, password, name }` | `AuthResponse` (201) + refresh cookie |
| `POST` | `/api/v1/auth/login` | `{ email, password }` | `AuthResponse` (200) + refresh cookie |
| `POST` | `/api/v1/auth/refresh` | — | `AuthResponse` (200) + rotated cookie |
| `POST` | `/api/v1/auth/logout` | — | 204, cookie cleared |
| `POST` | `/api/v1/auth/logout-all` | — | 204, every session revoked |
| `GET` | `/api/v1/auth/me` | — | `AuthUser` |
| `GET` | `/api/v1/sessions?page=1&limit=20` | — | `Paginated<SessionSummary>` |
| `DELETE` | `/api/v1/sessions/:id` | — | 204 |
| `GET` | `/api/v1/tasks?page=1&limit=20` | — | `Paginated<Task>` |
| `POST` | `/api/v1/tasks` | `{ title, description?, status? }` | `Task` (201) |
| `GET` | `/api/v1/tasks/:id` | — | `Task` |
| `PATCH` | `/api/v1/tasks/:id` | partial | `Task` |
| `DELETE` | `/api/v1/tasks/:id` | — | 204 |
| `GET` | `/api/v1/health` | — | `{ status: "ok" }` |
| `GET` | `/api/v1/ready` | — | `{ status, checks }` (503 if DB down) |

Lists always return `{ data, meta }`. Never a bare array — growing one into a paginated
response later is a breaking change for every client. `limit` is capped at 100.

**Health probes** use a simple JSON shape (not the API error envelope):

| Endpoint | Purpose | Success | Failure |
| --- | --- | --- | --- |
| `GET /api/v1/health` | Liveness — process is up | `200 { "status": "ok" }` | — |
| `GET /api/v1/ready` | Readiness — can serve traffic (DB reachable) | `200 { "status": "ok", "checks": { "database": "up" } }` | `503 { "status": "error", "checks": { "database": "down" } }` |

Wire Kubernetes (or similar) liveness to `/health` and readiness to `/ready`.

**Controllers never return entities.** They return `TaskResponseDto`, built with
class-transformer's `excludeExtraneousValues`, so only `@Expose()`d fields reach the wire.
A column added to the entity tomorrow — a password hash, an internal flag, a soft-delete
timestamp — is dropped by default instead of leaking. Keep it that way.

Request bodies go through a global `ValidationPipe` with `whitelist` and
`forbidNonWhitelisted`, so unknown fields are rejected with a 400 rather than silently
assigned.

### Errors

Every non-2xx response has one shape, declared in `packages/contracts/src/error.ts`:

```jsonc
{
  "error": {
    "code": "VALIDATION_FAILED",     // branch on this, never on message
    "message": "Request validation failed",
    "details": [                      // VALIDATION_FAILED only
      { "field": "title", "message": "title must be longer than or equal to 1 characters" }
    ],
    "requestId": "46c92c80-a756-4c1e-9c14-80ed46072c1f",
    "timestamp": "2026-08-13T08:04:17.094Z",
    "path": "/api/v1/tasks"
  }
}
```

A body either has an `error` key and is a failure, or does not and is a success — that is
what `isApiError()` checks, and why the envelope is wrapped rather than flat.

Codes: `VALIDATION_FAILED`, `BAD_REQUEST`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`,
`CONFLICT`, `RATE_LIMITED`, `INTERNAL`. Messages are for humans and may be reworded without
it being a breaking change; codes may not.

Everything leaves through `AllExceptionsFilter`. Nest's built-in exceptions
(`NotFoundException`, `ForbiddenException`, …) map to codes automatically; throw
`ApiException` when you need an explicit one. **An unexpected throw becomes a fixed
`INTERNAL` message** — stack traces, driver errors and failing SQL are logged server-side
and never travel to the client.

`requestId` reuses an inbound `x-request-id` header when present and is echoed on the
response (and exposed via CORS), so the id a user quotes from the UI finds the full stack
trace in the server log.

On the client, `src/lib/api-error.ts` has `toApiError`, `errorMessage` and `fieldErrors`.
`toApiError` returns `null` when the failure never reached the API — a dropped connection or
a proxy error page — so those are not reported as if the API had spoken.

### Auth on the server

Every route is authenticated by default: `JwtAuthGuard` is registered as a global `APP_GUARD`,
so a new endpoint is protected unless it carries `@Public()`. Forgetting `@Public()` on a
genuinely public route is the failure mode here, not the reverse — and an e2e test fails if the
global guard is ever removed.

**Registration ends in the same state as a login.** `POST /auth/register` creates the account and
then signs it in through the same session-issuing path `login` uses, so there is one place that
mints sessions and one place that sets the cookie. It answers 201 (it creates a resource) where
login answers 200, and like login it revokes the session behind any refresh cookie the browser
presents, since the response is about to overwrite that single cookie slot.

Duplicates are detected by the unique index on `users.email`, not by a `findByEmail` pre-check —
a check-then-insert races under concurrent submits and the constraint cannot. The violation is
caught and returned as `409 EMAIL_TAKEN`, a distinct code so a client can say "that email is
already in use" instead of showing a generic failure. **Accepted trade-off:** that reply confirms
which addresses are registered, so `AuthService.login`'s dummy-hash timing defence is now
defence-in-depth rather than a real secrecy boundary. Rate limiting, not silence, is the
mitigation for bulk enumeration — see the known gap below.

**The input policy is shared, not restated.** `EMAIL_MAX_LENGTH`, `NAME_MAX_LENGTH` and
`passwordProblem()` live in `packages/contracts/src/password.ts`, and both `RegisterDto` and the
frontend's `RegisterPage` call the same function. A password rule copied into the browser is the
classic way the two drift: the form starts accepting what the API rejects — a 400 the user cannot
act on — or refusing addresses the API would have taken. The browser's copy is a courtesy that
saves a round trip; the DTO is the enforcement, and it runs on every request regardless.

The password rule itself is deliberately modest — at least 8 characters, containing a letter and
a number, at most 256 — and it is one `@Validate` constraint rather than a stack of `@MinLength`
+ `@Matches`, so a rejection carries exactly one message the form can put under the field. The
256-character ceiling is a denial-of-service bound, not a strength rule: registration always
hashes with Argon2 on a public route, and hashing cost grows with input length.

`name` is trimmed before `@IsNotEmpty()` runs — transforms run first — so a name of pure
whitespace is a 400 rather than a blank display name everywhere the user's name appears.
Passwords are deliberately *not* trimmed: spaces are legitimate password characters, and
stripping them at registration would lock the user out at login, which compares verbatim.

Email is normalized (trimmed and lowercased) by a shared `@NormalizeEmail()` decorator applied to
**both** `RegisterDto` and `LoginDto`. Applying it to only one is a silent lockout: `findByEmail`
is an exact match, so an account registered as `Foo@Bar.com` could never be reached by a login
typing the same thing.

**Two token types, two lifetimes.** A short-lived JWT access token goes in the response body
and is sent as `Authorization: Bearer …`. The long-lived refresh token never appears in a
response body at all — it travels only in an httpOnly cookie scoped to `Path=/api/v1/auth`, so
no script on the page can read it and it is never attached to `/api/v1/tasks`.

**A session is a device; a refresh token is one rotation step.** `sessions` holds one row per
login, with a stable id that access tokens carry as `sid`. `refresh_tokens` holds one row per
rotation, all pointing back at that session. The split is what lets a refresh rotate the token
without disturbing access tokens already in flight, keeps `GET /sessions` a list of devices
rather than a rotation log, and makes revoking a whole family a single
`UPDATE sessions SET "revokedAt" = now()`.

**Rotation with reuse detection.** Every refresh spends its token and mints a replacement.
Presenting a token that was already spent means one of two things:

- inside `REFRESH_ROTATION_GRACE_MS` — two tabs raced, so another child is minted off the same
  parent and nothing is revoked. The window is measured from the token's *first* use and is
  never re-stamped; sliding it forward would let an attacker replay a stolen token forever
  without ever tripping detection.
- past that window — the token leaked. The entire session family is revoked, which kills both
  the refresh chain and every access token issued from that session on their next request.

Unknown, expired and already-revoked tokens revoke nothing: expiry is not theft, and a random
guess must not be able to log somebody out. All four failures return the same
`401 UNAUTHENTICATED` with the same message — the client's remedy is identical, and confirming
to an attacker that a replay was *detected* is free intelligence. The detail goes to the log.

**Expiry is absolute, never sliding.** `sessions.expiresAt` is set at login and never extended,
and each rotated token inherits it. Sliding expiry would let a stolen token grant indefinite
access, which is exactly what reuse detection exists to bound.

**Session hygiene.** `MAX_SESSIONS_PER_USER` caps concurrent logins, revoking the least
recently active past the cap on the next login — ordered by `COALESCE("lastUsedAt",
"createdAt")`, since `lastUsedAt` is null until a session's first rotation and would otherwise
sort as *most* recent. Logging in twice in one browser also revokes the session behind the
cookie being overwritten, so a re-login does not leave a ghost device in `GET /sessions`.
Sessions are revoked, never deleted; `deleteExpiredSessions()` is the cron hook point for
collecting them once `expiresAt` passes, and is deliberately not wired to a scheduler.

**CSRF.** `/auth/refresh` and `/auth/logout` must be public — the access token is expired by
definition — so their only credential is an automatically-attached cookie. `SameSite=Lax`
closes this, since both are POST-only and unreachable by top-level navigation. An
`OriginCheckGuard` rejects a present-but-foreign `Origin` as a second layer, so the protection
does not silently depend on `COOKIE_SAME_SITE` never becoming `none`. `/auth/register` and
`/auth/login` carry the same guard: a cross-site POST that silently signs a victim's browser
into an attacker-controlled account is the login-CSRF variant of the same problem.

**Known gap:** nothing rate-limits register, login or refresh. `RATE_LIMITED` exists in
`ApiErrorCode` and has no producer; `@nestjs/throttler` is not a dependency. All three are
brute-forceable, the session cap bounds stored rows but not attempts, and register is
additionally an email-enumeration oracle by design (see above) — which makes throttling it the
higher-value half of closing this gap.

## Frontend

```bash
cd frontend
yarn dev           # http://localhost:5173
```

Vite proxies `/api` to `http://localhost:3000`, so dev needs no CORS handling or base URL.
For production builds where the API is on another origin, set `VITE_API_URL`
(see `.env.example`). `strictPort` is on so Vite fails loudly instead of drifting to 5174
and quietly breaking the proxy.

Server state lives in RTK Query. There is **one** API slice — `baseApi` in
`src/app/baseApi.ts` — and features add endpoints with `injectEndpoints`
rather than calling `createApi` again. One cache, one middleware, and one place for auth
headers and 401-refresh. It lives under `src/app/` rather than in a feature folder because
both `features/auth` and `features/tasks` depend on it. Use plain slices in
`src/app/store.ts` for local UI state.

Routing is `react-router` v7, used as a router only — no `loader`/`action`/`fetcher`, since
loaders would need the access token out of Redux. A production deploy needs an SPA fallback
(every path serves `index.html`); `vite dev` and `vite preview` already do this.

### Auth in the client

The access token lives in a Redux slice **in memory only** — never `localStorage` or
`sessionStorage`. On boot, `bootstrapAuth` (called at module scope in `main.tsx`, not in a
`useEffect`, which would run twice under StrictMode and burn a rotated refresh token) posts
once to `/auth/refresh` using the httpOnly cookie. `App` renders a splash until that settles,
so a deep link never flashes `/login`.

`baseQueryWithReauth` retries a request once after a `401 UNAUTHENTICATED`, sharing a single
in-flight refresh across every request that fails at the same time — without that, a page with
three queries would fire three refreshes and the last two would present an already-rotated
token. Login, refresh, logout and logout-all are exempt: their 401 *is* the answer. When the
refresh itself fails, `loggedOut()` is dispatched and `RequireAuth` redirects to `/login`.

## Notes for what's coming

- **WebSockets** — keep app servers stateless (no in-memory socket or session maps) so a
  second instance can be added with a Redis adapter rather than a rewrite.
- **Payments** — Stripe webhook signature verification needs the raw request body, which
  Nest's JSON parser consumes. Create the app with `NestFactory.create(AppModule,
  { rawBody: true })` before integrating. Plan idempotency keys on money-moving endpoints.
- **RBAC** — `Task` has no owner column yet. Adding audit/ownership columns to a base
  entity before the table grows avoids a backfill later.
- Not yet present and not path-dependent: Docker Compose, e2e test database.
