# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The root [README.md](README.md) is the authoritative reference for the API surface, error
envelope, dev.sh commands and rationale — read it before changing anything in those areas.
This file covers what the README does not: auth internals and the current state of the work.
(`backend/README.md` and `frontend/README.md` are untouched framework boilerplate — ignore them.)

## Commands

Package manager is **yarn** (1.x). Three separate installs — there is no yarn workspace.

```bash
./dev.sh                    # install → build contracts → migrate → start backend+frontend → status
./dev.sh contracts          # rebuild + re-copy the shared contracts package
./dev.sh logs backend -f    # tail .dev/logs/
./dev.sh restart backend
```

```bash
cd backend
yarn test                             # jest, *.spec.ts colocated under src/
yarn test -t "rejects a wrong password"   # single test by name
yarn test src/auth/auth.service.spec.ts   # single file
yarn test:e2e                         # needs a live Postgres — hits /health and /ready for real
yarn lint                             # eslint --fix
yarn migration:generate src/database/migrations/AddSomething && yarn migration:run

cd frontend
yarn lint                             # oxlint
yarn build                            # tsc -b && vite build
```

The frontend has no test runner configured.

## Cross-cutting invariants

**`packages/contracts` is copied, not linked.** `scripts/sync-contracts.mjs` builds it and
`cpSync`s `dist/` into `backend/node_modules` and `frontend/node_modules` (the drive cannot do
symlinks — see README). It runs as a `postinstall` in both apps, but **after editing
`packages/contracts/src` you must run `./dev.sh contracts` yourself** or both sides keep
compiling against the stale copy.

**Contract drift is a compile error, by design.** `TaskResponseDto implements Task` — if the DTO
and `packages/contracts/src/task.ts` disagree, the backend build fails instead of the browser
getting a surprise. Keep that `implements` clause on any new response DTO.

**`TaskStatus` is a const object, not a TS `enum`** — the frontend compiles with
`erasableSyntaxOnly`. Never introduce an `enum` into contracts.

**Every env var must be added to `backend/src/config/env.validation.ts`.** Joi runs with
`whitelist`, so a variable missing from the schema is invisible to `ConfigService` no matter
what `.env` says.

**Never return an entity from a controller.** Go through a `@Expose()`-only DTO built with
`excludeExtraneousValues` (`TaskResponseDto.from`). Lists return `{ data, meta }`, never a bare array.

## Auth architecture

`JwtAuthGuard` is registered as a global `APP_GUARD` in [auth.module.ts](backend/src/auth/auth.module.ts),
so **every route is authenticated unless it carries `@Public()`**. New endpoints are protected by
default; forgetting `@Public()` on a genuinely public one is the failure mode, not the reverse.
The e2e test asserts this — it fails if the global guard is removed.

- It's a plain guard, **not a Passport strategy**, despite `passport`/`passport-jwt` being in
  `package.json` (unused). Don't reintroduce a strategy layer.
- Signing/verify options (HS256 pinned, issuer, audience, expiry) live **only** in the
  `JwtModule.registerAsync` factory. `jwtService.verify(token)` is called with no options so it
  inherits them — don't restate them at a call site.
- The guard hits the DB on every request (`sessionsService.isActive(sid)`) so revocation is
  immediate. That cost is deliberate.
- Handlers take the owner id from `@CurrentUser()` only — never a route param or body.
  `TasksService` scopes every query by `ownerId`.
- Two hashes for two jobs: **Argon2id** for passwords ([common/crypto/password.ts](backend/src/common/crypto/password.ts)),
  **SHA-256** for refresh tokens ([common/crypto/sha256.ts](backend/src/common/crypto/sha256.ts)),
  which are 32 random bytes and need speed, not stretching. Don't merge them.
- `AuthService.login` verifies against a dummy Argon2 hash when no user matches, to keep timing
  flat and avoid leaking which emails are registered. Note this is now defence-in-depth only:
  `POST /auth/register` answers `409 EMAIL_TAKEN` on a duplicate, which reveals the same thing
  deliberately. Don't "fix" either side to match the other — the trade-off is recorded in README.

### Registration

`register` and `login` must stay shaped alike; every past bug here came from one drifting:

- `AuthService.register` returns `Promise<IssuedAuth>` — a total type, like `login`. It creates
  the user and then **flows into the same session-issuing path**, so there is exactly one place
  that mints a session and one that sets the cookie. Never let it resolve `undefined`; a handler
  that falls through answers `200` with an empty body, which a client reads as success.
- It revokes the session behind the presented refresh cookie, exactly as `login` does and for
  the same reason (the single browser-wide cookie slot is about to be overwritten). Both take
  the raw cookie via `readRefreshCookie` in the controller.
- **Duplicates are caught, not pre-checked.** `UsersService.create` relies on the unique index on
  `users.email`; `register` catches the Postgres `23505` violation and throws `EMAIL_TAKEN`. A
  `findByEmail`-then-insert races under concurrent submits — don't reintroduce one.
- Email normalization lives in the shared `@NormalizeEmail()` decorator
  ([auth/dto/normalize-email.ts](backend/src/auth/dto/normalize-email.ts)) and is applied to
  **both** `LoginDto` and `RegisterDto`. Applying it to one only is a silent permanent lockout,
  since `findByEmail` is an exact match. It also guards non-strings on purpose: transforms run
  before validators, so an unguarded `.trim()` turns a malformed body into a 500 instead of a 400.
- Register is `201`; login is deliberately `200`.

Dev seed user (from migration `AddUserNameAndSeedTestUser`, upgraded to Argon2 by a later one):
`rashiqrahaman@yahoo.com` / `Password123!`.

### Sessions and refresh tokens

**A session is a device; a refresh token is one rotation step.** `SessionEntity` is one login
with a stable id — the `sid` in every access token — and `RefreshTokenEntity` is one row per
rotation, pointing back at it. Never collapse these back into one table: rotation would then
replace the session row, killing every access token the instant its client refreshed, and
`GET /sessions` would become a rotation log instead of a device list. The family *is* the
session, so revoking one is a single `UPDATE sessions SET "revokedAt" = now()` and the children
need no update — both `isActive` and `rotate` gate on the parent.

- **The rollback trap.** On reuse detection the family must be revoked *and* the request
  rejected. `rotateWithin` returns a discriminated `RotateOutcome` and `rotate` throws **after**
  the transaction commits. Throwing from inside `manager.transaction` would roll back the
  revocation you just wrote, leaving a detector that still 401s the caller — and so still looks
  correct in casual testing — while never actually revoking anything. This is the single
  highest-severity trap in the feature; `auth.e2e-spec.ts` catches it.
- **Lock the token row alone.** `setLock('pessimistic_write')` with no join or `relations`:
  Postgres rejects `FOR UPDATE` against the nullable side of an outer join, and TypeORM's
  `findOne({ lock, relations })` throws outright. The session is loaded as a separate read.
- **The grace window is anchored at first use.** On the benign two-tab path, the old row is left
  completely untouched — `usedAt` is not re-stamped and `replacedByTokenId` is not overwritten.
  Re-stamping would slide the window forward on every replay, so an attacker replaying every
  `grace − ε` would read as benign forever and detection would never fire. There is an e2e test
  specifically for this.
- **Lock and grace are a pair.** The lock alone turns a double-tab race into a forced logout;
  the grace window alone leaves the state machine non-deterministic.
- Expiry is **absolute, never sliding**. `sessions.expiresAt` is set at login and never extended;
  each child inherits it.
- `lastUsedAt` is written in exactly one place — `rotate`'s happy path. Not per request: that
  would turn the guard's single indexed PK read into a read plus a write on every API call.
- `MAX_SESSIONS_PER_USER` is enforced inside `create`'s transaction, after the insert, as one
  set-based statement. `ORDER BY COALESCE("lastUsedAt", "createdAt") DESC` is load-bearing —
  `lastUsedAt` is null until a session's first rotation and Postgres sorts nulls first under
  `DESC`, so a bare ordering would evict exactly the sessions in use.
- Sessions are **revoked, never deleted**. `deleteExpiredSessions()` is implemented, unit-tested
  and deliberately **uncalled** — a cron hook point. `@nestjs/schedule` is not a dependency.
- `AuthService.login` revokes the session behind whatever refresh cookie the browser presented,
  after the password check. The cookie is one shared browser-wide slot, so without this a
  re-login in the same browser would strand the old session as a ghost device.

### The refresh cookie

All of it lives in [refresh-cookie.ts](backend/src/auth/refresh-cookie.ts) as **plain functions,
not an `@Injectable()`** — `SessionsController` needs `clearRefreshCookie` too, and a provider
would force `SessionsModule → AuthModule` while `AuthModule` already imports `SessionsModule`.

- `clearRefreshCookie` **must** spread the same options as `setRefreshCookie` minus `maxAge`.
  One mismatched character and `clearCookie` leaves the cookie in place, so logout silently does
  nothing while still answering 204. That asymmetry is the single most common bug in this
  feature and the entire justification for the file; `refresh-cookie.spec.ts` pins it.
- `Path=/api/v1/auth` is built from the API constants, and keeps the long-lived credential off
  the task routes. It rules out the `__Host-` prefix, which requires `Path=/` — do **not**
  "fix" `AUTH_COOKIE_NAME` into a `__Host-` name, or the browser will reject the cookie outright.
- The refresh token appears **only** in the cookie, never in a response body.
- `logout` is `@Public()` and reads the cookie: a protected logout 401s exactly when a user most
  wants it to work. `logout-all` stays protected — it is global and destructive.
- `refresh` and `logout` are `@Public()`, so `request.user` is undefined; `@CurrentUser()` must
  never appear in either.
- `@Res({ passthrough: true })` is mandatory on every cookie-touching handler. Without it Nest
  stops serialising the return value and the handler hangs.
- `SessionsModule` must **never** import `AuthModule` — that is a cycle, and it is unnecessary
  because the guard is a global `APP_GUARD`.

## Frontend auth rules

- The single `baseApi` now lives in [app/baseApi.ts](frontend/src/app/baseApi.ts), **not** in
  `features/tasks/tasksApi.ts` — both `features/auth` and `features/tasks` depend on it. Features
  extend it via `injectEndpoints`; never call `createApi` a second time.
- The access token is held **in memory only**, in `authSlice`. No `localStorage`, no
  `sessionStorage`, no `redux-persist`. A reload restores the session through the refresh cookie.
  Adding any persistence layer here is the thing to catch in review.
- No module-level token mirror. `prepareHeaders` reads the store. The `baseApi ↔ authSlice` cycle
  is type-only (`import type` + `verbatimModuleSyntax` emits nothing), so it does not exist at runtime.
- `runRefresh` in `baseApi.ts` calls the refresh URL through `rawBaseQuery` on purpose. Routing it
  through `authApi.endpoints.refresh.initiate()` would make a real runtime cycle in which `baseApi`
  is `undefined` at `injectEndpoints` time.
- The RTK Query slices feed `authSlice` through `onQueryStarted`, never `extraReducers` +
  `addMatcher` — the latter is a value-level cycle evaluated at module scope.
- `bootstrapAuth` is dispatched at module scope in `main.tsx`. A `useEffect` runs twice under
  StrictMode and the second call replays a burned refresh token — a dev-only phantom logout.
- `baseApi.util.resetApiState()` is called in `LoginPage`'s submit handler, not on logout, where a
  live subscriber would immediately refetch against a cookie the server has just cleared.
- **Auth state is per-tab; only the refresh cookie is shared.** `loggedOut()` in one tab does not log
  out the others — they run on their in-memory access token until it expires or 401s, and only then
  does their refresh fail and drop them on `/login`. Convergence is by expiry, not by broadcast. The
  likely future misreading is "logout in one tab logs out all tabs"; it does not, and `BroadcastChannel`
  is a deliberate non-goal (a second source of truth for auth outside Redux).
- Before dispatching `loggedOut()`, `baseQueryWithReauth` checks the access token is still the one the
  request failed under. A refresh that resolves after a login completed is stale and must not wipe the
  new session. Don't "simplify" that check away.

## Current state

Auth is complete on both sides: login, refresh with rotation and reuse detection, logout,
logout-all, `GET /auth/me`, `GET /sessions` and `DELETE /sessions/:id` all exist, and the
frontend described below is wired to them. `backend/test/auth.e2e-spec.ts` and
`session-cap.e2e-spec.ts` cover the cycle end to end against a live Postgres.

`POST /auth/register` exists on the **backend only** (see *Registration* above). It went through
review and its findings are fixed, but **it has no tests yet** — no unit spec, no e2e case — and
**no frontend consumes it**: there is no `RegisterPage`, no `register` mutation in `authApi`, and
no route to it. Both are the obvious next pieces of work. The e2e cases worth writing first:
register → 201 + cookie + the returned token works on `GET /tasks`; duplicate → 409
`EMAIL_TAKEN`; case-variant duplicate → 409; register from a logged-in agent → the old session's
token 401s. Note those tests create *users*, so their cleanup must delete them, not just sessions.

Known gaps, deliberate and noted in the README: **nothing rate-limits register, login or
refresh** — `RATE_LIMITED` exists in `ApiErrorCode` with no producer, and `@nestjs/throttler` is
not a dependency; register is additionally an email-enumeration oracle by design, which makes
throttling it the higher-value half. The e2e suite also runs against the development database
rather than a scratch one; it cleans up the seed user's sessions after itself, but a dedicated
test database is still the right fix.

## Conventions

- Migrations only — `synchronize` is `false` everywhere and never runs on boot. Both the app and
  the TypeORM CLI build options from `src/config/database.config.ts`.
- Errors: throw Nest exceptions or `ApiException`; `AllExceptionsFilter` maps everything to the
  `{ error: { code, message, ... } }` envelope. Clients branch on `code`, never `message`.
  An unexpected throw becomes a fixed `INTERNAL` — stack traces never reach the client.
- **`yarn lint` in `backend/` is `eslint --fix`** — it rewrites files rather than reporting on them.
  A run in 2026-08 reformatted the whole backend, so `auth/**` and `sessions/**` are no longer the
  4-space, non-Prettier-clean outliers they used to be; the backend is now uniformly 2-space and
  Prettier-formatted. Older docs (including parts of [AUTH_PLAN.md](AUTH_PLAN.md)) still say
  "4-space" for those files — that instruction is stale. It leaves ~15 errors it cannot auto-fix,
  mostly `no-unsafe-*` in `tasks/` and the specs; those are pre-existing, so a red `yarn lint` is
  not necessarily your change. Still: match the file you are editing rather than reformatting it.
- The frontend's `yarn lint` is `oxlint`, which only reports. It is clean.
