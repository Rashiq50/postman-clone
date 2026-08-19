# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The root [README.md](README.md) is the authoritative reference for the API surface, error
envelope, dev.sh commands and rationale — read it before changing anything in those areas.
This file covers what the README does not: auth internals and the current half-built state.
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
  flat and avoid leaking which emails are registered.

Dev seed user (from migration `AddUserNameAndSeedTestUser`, upgraded to Argon2 by a later one):
`rashiqrahaman@yahoo.com` / `Password123!`.

## Current state — auth is half-built

Knowing where the seams are matters more than the finished parts:

- `POST /api/v1/auth/login` is the only auth route. **There is no refresh, logout, or session
  rotation endpoint.** `SessionsController` is an empty shell and `SessionsService` carries
  commented-out stubs (`findByRefreshToken`, `rotate`, `revoke`, `revokeAllForUser`,
  `deleteExpiredSessions`) marking the intended surface.
- Login returns the refresh token **in the JSON body**. `AUTH_COOKIE_NAME` is validated at boot
  and `cookie-parser` is a dependency, but neither is wired up yet — the httpOnly-cookie path is
  intended and unfinished.
- `UsersService` is an empty class; `AuthService` talks to the user repository directly.
- **The frontend auth is complete and is ahead of the backend.** It is written against the finished
  API in [AUTH_PLAN.md](AUTH_PLAN.md) — `POST /auth/refresh`, `/auth/logout`, `/auth/logout-all`,
  `GET /auth/me`, `GET /sessions`, `DELETE /sessions/:id`, and a login response of
  `{ accessToken, expiresIn, user }` with the refresh token in an httpOnly cookie. Until Part 2
  lands, everything except login 404s and login's response has no `user`, so the client cannot
  finish signing in. Do not "fix" the client to match today's backend — finish the backend.

### Frontend auth rules

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

## Conventions

- Migrations only — `synchronize` is `false` everywhere and never runs on boot. Both the app and
  the TypeORM CLI build options from `src/config/database.config.ts`.
- Errors: throw Nest exceptions or `ApiException`; `AllExceptionsFilter` maps everything to the
  `{ error: { code, message, ... } }` envelope. Clients branch on `code`, never `message`.
  An unexpected throw becomes a fixed `INTERNAL` — stack traces never reach the client.
- Formatting is inconsistent across the tree (the `auth/` and `sessions/` files use 4-space indent
  and are not Prettier-clean). Match the file you are editing rather than reformatting it.
