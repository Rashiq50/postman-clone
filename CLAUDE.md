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
- **The frontend has no auth at all** — no login screen, no router, and `baseApi` sends no
  `Authorization` header. Since the global guard protects `/tasks`, the task UI gets 401s against
  a running backend. Auth headers and 401-refresh belong in the single `baseApi` in
  [tasksApi.ts](frontend/src/features/tasks/tasksApi.ts) (features extend it via `injectEndpoints`;
  never call `createApi` a second time).

## Conventions

- Migrations only — `synchronize` is `false` everywhere and never runs on boot. Both the app and
  the TypeORM CLI build options from `src/config/database.config.ts`.
- Errors: throw Nest exceptions or `ApiException`; `AllExceptionsFilter` maps everything to the
  `{ error: { code, message, ... } }` envelope. Clients branch on `code`, never `message`.
  An unexpected throw becomes a fixed `INTERNAL` — stack traces never reach the client.
- Formatting is inconsistent across the tree (the `auth/` and `sessions/` files use 4-space indent
  and are not Prettier-clean). Match the file you are editing rather than reformatting it.
