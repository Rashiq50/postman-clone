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
yarn contrast                         # WCAG audit of the theme tokens in src/index.css
```

The frontend has no test runner configured; `yarn contrast` is the closest thing it has to
one, and it is a plain node script rather than a suite.

## Cross-cutting invariants

**`packages/contracts` is copied, not linked.** `scripts/sync-contracts.mjs` builds it and
`cpSync`s `dist/` into `backend/node_modules` and `frontend/node_modules` (the drive cannot do
symlinks — see README). It runs as a `postinstall` in both apps, but **after editing
`packages/contracts/src` you must run `./dev.sh contracts` yourself** or both sides keep
compiling against the stale copy.

**Contract drift is a compile error, by design.** `RequestResponseDto implements ApiRequest` —
if the DTO and `packages/contracts/src/request.ts` disagree, the backend build fails instead of
the browser getting a surprise. Keep that `implements` clause on any new response DTO.

**`HttpMethod` and `WorkspaceRole` are const objects, not TS `enum`s** — the frontend compiles
with `erasableSyntaxOnly`. Never introduce an `enum` into contracts.

**Every env var must be added to `backend/src/config/env.validation.ts`.** Joi runs with
`whitelist`, so a variable missing from the schema is invisible to `ConfigService` no matter
what `.env` says.

**Never return an entity from a controller.** Go through a `@Expose()`-only DTO built with
`excludeExtraneousValues` (`RequestResponseDto.from`). Lists return `{ data, meta }`, never a
bare array.

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
- Handlers take the owner id from `@CurrentUser()` only — never a route param or body. Every
  domain query is scoped by membership in the `WHERE` (see *Domain and tenancy*).
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
- **The input policy is a shared contract, not a duplicated regex.**
  `passwordProblem()`, `EMAIL_MAX_LENGTH` and `NAME_MAX_LENGTH` live in
  [packages/contracts/src/password.ts](packages/contracts/src/password.ts); `RegisterDto` enforces
  them and `RegisterPage` pre-checks with the same function. Changing the rule means editing that
  file and running `./dev.sh contracts`. Never restate it on one side only.
- The password is validated by a single `@Validate` constraint, so one attempt produces one
  message — the form shows "must contain a number" rather than a pile of overlapping complaints.
  `name` is trimmed *before* `@IsNotEmpty()`; the password is never trimmed (spaces are legitimate
  characters and login compares verbatim).

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
  the resource routes. It rules out the `__Host-` prefix, which requires `Path=/` — do **not**
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

- The single `baseApi` lives in [app/baseApi.ts](frontend/src/app/baseApi.ts) rather than in any
  one feature folder — `features/auth`, `features/tree` and `features/requests` all depend on
  it. Features extend it via `injectEndpoints`; never call `createApi` a second time.
- `tagTypes` is `Session`, `Me`, `Workspace`, `Tree`, `Request`. There is deliberately
  **no `Collection`, `Folder` or `Environment` tag**: none has a read endpoint, so nothing
  would provide one, and a tag nothing provides makes the cache look covered where it is not.
  Each arrives with the feature that reads it.
- The access token is held **in memory only**, in `authSlice`. No `localStorage`, no
  `sessionStorage`, no `redux-persist`. A reload restores the session through the refresh cookie.
  Adding any persistence layer here is the thing to catch in review. (The theme preference is
  in `localStorage` — see *Theming*. That is a display setting, not a credential, and it is
  the only thing this app stores.)
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
- `RegisterPage` mirrors `LoginPage`: same `baseApi.util.resetApiState()` in the submit handler
  (registering while a session is live is a real path — the API revokes the old one), same
  `from` handling, and no client-side rule the server does not also enforce. Its validation is a
  courtesy; `passwordProblem` is imported from contracts precisely so it cannot drift from the
  DTO. `register` is in `NEVER_REAUTH` — a failure there is the answer, not a stale token.
- Before dispatching `loggedOut()`, `baseQueryWithReauth` checks the access token is still the one the
  request failed under. A refresh that resolves after a login completed is stale and must not wipe the
  new session. Don't "simplify" that check away.

## Domain and tenancy

`User → Workspace → { Collection → Folder → Request, Environment }`, plus
`workspace_members`. Organizations are deferred behind a nullable, always-NULL
`workspaces."organizationId"` with no FK — do not add the column, it is already there.

**Authorization is folded into the SQL. There is no authorization guard and adding one is a
regression, not a refactor.** `workspace-scope.ts` holds the fragments; `scopedWhere()` builds
the predicate used by *both* the hot-path statement and the failure-path visibility check, so
the two cannot drift. The argument against a guard is recorded in that file in full — the
decisive part is that `POST /requests` carries its parent id in the **body**, so a guard keyed
on route params sees nothing to check and permits a cross-tenant write while passing every
hand test. `workspaces.e2e-spec.ts` has the assertion that catches it.

- **The scoped-`UPDATE` pattern covers update, move and delete. It does not cover `POST`** —
  there is no row to scope and `affected === 0` never arises. Every create instead resolves
  its parent through the scoped query *inside its transaction*, with the foreign key as the
  race backstop, and denies via `explainParentDenial` keyed on the parent the caller named.
- **404 when not a member** (a 403 would confirm the id is real, which is all an attacker
  needs to enumerate); **403 when a member's role is too low** (leaks nothing; they can
  already read it). Both live in `scope-denial.ts`, and the second query is paid only on the
  failure path.
- Role checks live nowhere but the `roles` array bound into the fragment. There is no
  `if (role === 'VIEWER') throw` anywhere; adding a role is editing one array. Roles are
  `varchar` + `CHECK`, never a Postgres enum — a `CHECK` is one statement to change.
- **`provisionPersonalWorkspace` is a plain function taking the caller's `EntityManager`**, and
  runs inside `UsersService.create`'s transaction. A user with no workspace is a silently and
  permanently broken account with no repair path. `AuthService.register` needed no change and
  should keep needing none: `manager.transaction` re-throws the driver error untouched, so its
  `23505 → EMAIL_TAKEN` catch still fires. Both `users.service.spec.ts` and
  `auth.service.spec.ts` pin that.
- Like `refresh-cookie.ts`, `workspace-scope.ts`, `scope-denial.ts` and
  `provision-personal-workspace.ts` are **plain functions, not providers** — a provider would
  force `CollectionsModule → WorkspacesModule` and `RequestsModule → WorkspacesModule` edges
  that buy nothing, and a service bound to the default manager cannot enlist in a caller's
  transaction anyway. **Nothing imports `WorkspacesModule`.** Keep it that way.
- `TreeController` lives in `CollectionsModule` despite serving `/workspaces/:id/tree`; that is
  what keeps `WorkspacesModule` free of a `CollectionsModule` edge.

### Schema traps

- **Two composite FKs — `FK_folders_parent` and `FK_requests_folder` — are owned by the
  migration**, because TypeORM cannot express a two-column foreign key. They make a
  cross-collection parent unrepresentable in SQL rather than a service invariant someone
  forgets. The visible cost: `migration:generate` proposes replacing each with a
  single-column FK on every run. **That diff is expected and must be discarded** — it is the
  *only* drift these tables produce, because every other constraint, index and default is
  declared on the entities precisely so this one stays easy to recognise. (The repo has
  separate pre-existing drift on the `sessions` FK names.)
- **`FK_requests_folder` relies on `MATCH SIMPLE`**, the Postgres default: with `folderId`
  NULL the constraint is not checked at all, which is exactly how a request sits at the
  collection root. `MATCH FULL` would forbid every root-level request.
- **jsonb defaults must be SQL expressions with no `::jsonb` cast**, spelled the way Postgres
  normalizes them (`'{"mode": "none"}'`, with the space). `default: []` compares a JS value
  against a SQL default; a cast is stripped before comparison. Either one emits churn forever.
- **`position` has no column default anywhere**, deliberately: the service always computes
  `MAX + 1024`, so a default could only ever mask a path that forgot to.
- **Folder move cycles are not caught by the FK.** A cycle is self-consistent — every row
  still points at a real parent in the same collection — but the ring detaches from the
  collection root and becomes invisible *and* undeletable. `FoldersService` runs a
  `WITH RECURSIVE` descendant check before the sibling lock; 409 on a hit.
- **`IS NOT DISTINCT FROM`, never `=`, for a nullable parent in a sibling query.**
  `"folderId" = $2` with `$2` NULL is never true, so every root-level item computes against
  zero siblings and stacks at one position.
- ⚠️ **Secrets are plaintext** in `requests.auth` and `environments.variables`, and go out on
  the wire. Documented in the README as an accepted slice trade-off; do not treat the
  `type="password"` inputs as protection.
- `workspaces.ownerUserId ON DELETE CASCADE` is right only while every workspace is personal.
  It is also what makes the e2e cleanup work, so changing it is a paired change.

## Frontend workbench rules

- Two shells: `AppShell` (centred `max-w-3xl`, used by `/sessions`) and
  `WorkbenchShell` (`h-screen overflow-hidden`, fixed sidebar, independently scrolling panes).
  `AppHeader` takes one `wide` prop. ⚠️ `min-h-0` on the workbench grid and `<main>` is
  load-bearing — a grid child defaults to `min-height: auto`, so without it the panes size to
  content and the whole page scrolls.
- **The workspace id lives in the URL, not Redux.** Nothing but the theme preference is
  persisted, so an id in Redux does not survive a reload and every refresh would silently
  pick "the first workspace" — invisible until a user has two.
- ⚠️ **Because the id is in the URL it outlives the session that produced it, so `WorkspaceGuard`
  wraps `w/:workspaceId` and bounces an id the signed-in user does not own back to `/`.** The
  path that needs it: signing out sends `RequireAuth` to `/login` with
  `from = /w/<previous user's workspace>`, and `LoginPage` navigates to `from` after *whoever*
  signs in next — so user B lands on user A's URL and every request 404s. The guard sits above
  `WorkbenchShell` so the sidebar never mounts against a foreign id, and it lets the route
  through when the workspace list itself failed to load (a failed list is not evidence the id is
  wrong, and `/` would hit the same failure).
- **One `Tree` tag per workspace.** The tree is a single HTTP response, so a per-collection tag
  could never cause a partial refetch. ⚠️ **Every mutation argument carries `workspaceId` even
  though the server ignores it** — it is the invalidation key and there is no other way to
  reach one from a mutation. Forgetting it presents as "the sidebar doesn't update until I
  reload", which reads like a caching bug.
- ⚠️ **`updateRequest` invalidates `Tree` only when `name` or `method` is in the patch.** They
  are all the sidebar renders; invalidating on every save refetches the whole workspace each
  time someone edits a header.
- ⚠️ **`useRequestDraft` keys its seeding effect on `request?.id`, never `request`.** RTK Query
  returns a new object identity on every background refetch, so depending on the object wipes
  whatever the user was typing — intermittent, and presents as a dropped keystroke. There is no
  autosave either: autosave plus a tree that invalidates on renames is a refetch storm.
- ⚠️ **`NodeMenu` is `position: fixed` from `getBoundingClientRect()`, and flips above its row
  when there is no space below.** The sidebar is an `overflow-y-auto` container, so an
  absolutely-positioned menu on a bottom row is clipped and invisible; escaping that clip then
  lets it run off the *viewport*, which hides the bottom items just as well. Both halves are
  needed — the second was found by running the app, not by reading it.
- `useExpanded` holds one `Set` at `Sidebar` level, not per node (collapsing a parent unmounts
  its children, so reopening would reset every grandchild) and not in Redux. It resets on
  reload; that is accepted.
- **One optimistic update, and only one: inline rename**, via `treeApi.util.updateQueryData`
  with `patch.undo()` in the catch. It is the only operation whose round trip is a visible
  flicker on the element the user is looking at. Everything else refetches.
- No icon library and no editor library — text glyphs (`▸ ▾ ⋯`) and a plain `<textarea>` with a
  Format JSON button. Both are dependency decisions belonging to the execution slice.
- **No Send button, not even a disabled one.** Deliberate; see `RequestUrlBar.tsx`.
- Login and register default their post-auth `from` to `/`, the workbench.

## Theming

**Every colour is a semantic token.** Components say `bg-surface`, `text-fg-muted`,
`border-line`, `ring-focus`, `text-method-get` — never `bg-white`, `text-slate-500` or
`bg-indigo-600`. All four themes are blocks of custom properties in
[index.css](frontend/src/index.css) and nothing else, which is the invariant that makes a
fifth theme one CSS block instead of a thirty-file audit.

- ⚠️ **`@theme inline` is load-bearing.** It makes `bg-canvas` emit
  `background-color: var(--canvas)` instead of baking the value in at build time. Drop the
  `inline` and every utility freezes at its light-theme value — the page still renders, the
  themes just stop switching, which reads as a broken toggle rather than a CSS mistake.
- **Tailwind's default palette is still generated, on purpose.** Killing it with
  `--color-*: initial` would make a stray `bg-slate-50` generate *no rule at all* — a silent
  no-op is worse than a wrong colour. So the rule is enforced by review, not the compiler:
  a palette utility pins that element to light mode forever and nobody sees it until they
  switch themes. **If a token is missing, add a token.**
- **Adding a theme is exactly two edits**: a `:root[data-theme='<id>']` block in `index.css`
  (including its `color-scheme`, which is what themes native form controls, scrollbars and
  the `<select>` popup) and an entry in
  [themes.ts](frontend/src/features/theme/themes.ts). If a third edit seems necessary, the
  missing piece is a token.
- **`yarn contrast` is the guard on all of that**
  ([check-contrast.mjs](frontend/scripts/check-contrast.mjs)). It parses the CSS rather than
  importing it, composites alpha for the translucent soft fills, and exits non-zero. It
  caught four real failures on its first run — most importantly white-on-indigo-400 at
  2.98:1 on the dark theme's primary button, which is why the dark `--on-accent` is
  `#0f172a` and not white. **A token pair not listed in `PAIRS` is unchecked, not passing.**
- The dark themes do not invert the light one. Their soft fills are translucent so they tint
  whatever surface they land on, and `--accent` moves *lighter* while `--on-accent` flips
  *dark* — a single accent cannot be both readable link text on a dark canvas and a fill
  that white text sits on.

### The theme store

- ⚠️ **The theme is applied before React mounts**, by an inline **classic** script in
  [index.html](frontend/index.html). `type="module"` is deferred and a `useEffect` runs
  after the first paint, so either one flashes the light theme on every reload. That script
  mirrors `pc.theme`, `pc.theme.appearance`, `data-theme` and `data-appearance` from
  [theme.ts](frontend/src/features/theme/theme.ts) — change them together. It deliberately
  does *not* validate the stored id; `initTheme()` does that a moment later.
- **The appearance is mirrored into its own storage key** so that script needs no copy of
  the theme registry. Deriving it there instead would be a third place to update whenever a
  theme is added, and the one most likely to be missed.
- ⚠️ **The preference is in `localStorage`, and that does not contradict the rule in
  `authSlice`.** That rule is about the access token — a persisted credential is a real
  risk. A colour preference is not a credential, and one that resets on every reload is a
  bug. Do not "consistency-fix" this into memory.
- **It is not a Redux slice.** The store has to exist before React does (see the inline
  script), so a Redux copy would be a second source of truth for one DOM attribute — the
  same argument that keeps `BroadcastChannel` out of auth. `useTheme` wraps it with
  `useSyncExternalStore`; `getThemeState` must keep returning the *same* object until
  something changes, or every commit re-renders.
- `initTheme()` is called at module scope in `main.tsx`, next to `bootstrapAuth`, and
  registers the `matchMedia` listener that keeps `'system'` honest when the OS flips.

## Current state

Auth is complete on both sides: login, refresh with rotation and reuse detection, logout,
logout-all, `GET /auth/me`, `GET /sessions` and `DELETE /sessions/:id` all exist, and the
frontend described below is wired to them. `backend/test/auth.e2e-spec.ts` and
`session-cap.e2e-spec.ts` cover the cycle end to end against a live Postgres.

**The `tasks` module is gone.** It was the preliminary CRUD feature that proved out the global
guard, the DTO/contract seam and the error envelope, and the domain slice replaced it entirely.
Removed in one pass: `backend/src/tasks/`, `frontend/src/features/tasks/`,
`packages/contracts/src/task.ts`, the `Task` tag type, the `/tasks` route and its nav link, and
the `tasks` relation on `UserEntity`. Migration `1786670000000-DropTasks` drops the table and
its enum; the earlier migrations that created and extended `tasks` are deliberately left in
place, so a database migrated from empty still creates the table and then drops it. The e2e
suites used `GET /api/v1/tasks` as their "some protected route" probe and now use
`GET /api/v1/workspaces` — if a future slice needs such a probe, that is the one to reach for.
Nothing in the app references tasks any more. A `grep -i task` over `backend/src`,
`backend/test`, `frontend/src` and `packages/contracts/src` comes back empty apart from
`backend/src/database/migrations/`, and a hit anywhere else means something was reintroduced.
[AUTH_PLAN.md](AUTH_PLAN.md) and [DOMAIN_PLAN.md](DOMAIN_PLAN.md) still describe tasks at
length; they are historical records of what was planned, deliberately not rewritten, and every
`TasksService` / `TasksController` reference in them is now dangling.

Registration is complete on both sides too. `POST /auth/register` is covered by a `register`
block in `auth.service.spec.ts` and by `backend/test/register.e2e-spec.ts` (happy path + cookie +
protected route, duplicate and case-variant duplicate → 409 `EMAIL_TAKEN`, the validation matrix,
same-browser revocation, and the origin check). The frontend consumes it through `RegisterPage`,
the `register` mutation in `authApi` and the `/register` route.

Two things about `register.e2e-spec.ts` are load-bearing. It creates **users**, so its cleanup
deletes them — by the `e2e-register-` email prefix, which also sweeps up after a run that was
killed before its `afterAll`; sessions, refresh tokens and workspaces follow via
`ON DELETE CASCADE`. And it reads the cookie name from `ConfigService` rather than hard-coding
`pc_refresh_token` the way `auth.e2e-spec.ts` does — a local `.env` that renamed
`AUTH_COOKIE_NAME` makes that older suite report a missing cookie when the cookie is right
there.

`POST /auth/register` is now rate limited. `ApiThrottlerGuard`
([common/throttling/api-throttler.guard.ts](backend/src/common/throttling/api-throttler.guard.ts))
subclasses `ThrottlerGuard` for two reasons, both load-bearing: the base class throws
`ThrottlerException`, which would reach the client as a `RATE_LIMITED` code wrapped around the
message "ThrottlerException: Too Many Requests"; and the base class writes `Retry-After-<name>`
for any window not called `default`, so the plain `Retry-After` is set here instead. `retry-after`
is in `configure-app.ts`'s `exposedHeaders` — a cross-origin browser cannot read it otherwise.

- Two named windows (`burst`, `sustained`) apply together, built from `THROTTLE_*` env vars by
  `buildThrottlerOptions`. One window cannot be both generous enough for a shared NAT and tight
  enough to stop enumeration.
- Applied with `@UseGuards(ApiThrottlerGuard, OriginCheckGuard)` on `register` only — **never** as
  an `APP_GUARD`, which would put the resource routes on a shared IP budget. Throttler first, so a
  flood is bounded before anything else runs.
- **Two limits are per-process and per-proxy.** In-memory storage means N instances allow N× the
  rate; `req.ip` is the proxy's address because `trust proxy` is off, which behind a load balancer
  collapses every caller into one bucket. Both are documented in the README and in the guard.
- **Tests override `THROTTLER_OPTIONS`, not `process.env`.** `ConfigModule.forRoot()` reads and
  validates the environment while the `@Module` decorator is evaluated — at *import* time — so an
  assignment at the top of a spec is always too late. `register.e2e-spec.ts` raises the limit (it
  registers ~20 accounts in seconds), `register-throttle.e2e-spec.ts` lowers it, and
  `throttler.config.spec.ts` covers the env-to-options wiring as a pure function. The token is
  imported from `@nestjs/throttler/dist/throttler.constants` because the package index does not
  re-export it. `auth.controller.spec.ts` stubs the guard with `.overrideGuard`.

The **domain slice is complete on both sides**: workspaces + members, collections, folders,
requests and environments, with a sidebar tree and a request editor that saves. See *Domain and
tenancy* above for the rules and *Frontend workbench rules* for the client. Unit specs cover
ordering, the scope fragments, provisioning, `build-tree`, the folder cycle check, the requests
service and the jsonb constraints; `backend/test/workspaces.e2e-spec.ts` covers the API end to
end, including cross-tenant isolation and the `VIEWER` role seam.

**Theming is complete on the client** and there is no server side to it. Four themes (Light,
Dark, Midnight, Paper) plus System, a picker in the header and on both auth pages, and every
component converted off Tailwind's palette onto semantic tokens — the conversion was the bulk
of the work and is what keeps a fifth theme cheap. `yarn contrast` covers all four against
WCAG AA. See *Theming* above for the traps.

Deliberately **not** built for theming: the preference is **per browser, not per account** —
putting it on the user row means a migration, a column, a DTO and a PATCH endpoint to make a
setting follow someone between devices, and nothing else in this slice needed the API to
change. **No user-defined colours** either: a colour picker means runtime CSS variables, a
settings surface and contrast that can no longer be guaranteed, whereas a fixed set is
auditable by `yarn contrast`. Both seams are open — a stored preference is a string this
store already knows how to apply, and a custom theme is a `data-theme` value with its
variables written onto `<html>`.

Deliberately **not** built here, each for a stated reason: sending requests (its own security
surface — see the README), any environment UI (nothing observable without interpolation),
drag-and-drop (the `/move` endpoints exist and the kebab menu drives them; dnd is a
pure-frontend change later), invites and a members pane (no unused UI), and organizations
(the seam is one nullable column).

Known gap, deliberate and noted in the README: **login and refresh are still unthrottled.** The
machinery is in place, so it is a `@UseGuards` on each plus a decision about shared or separate
budgets. The e2e suite also runs against the development database
rather than a scratch one; it cleans up after itself, but a dedicated test database is still the
right fix. Until then `test:e2e` runs `--runInBand`: `auth.e2e-spec.ts` and
`session-cap.e2e-spec.ts` both mutate the *same* seed user's sessions, so in parallel workers one
suite deletes rows the other is mid-assertion about. Removing that flag makes the session-cap
suite fail intermittently and for reasons that have nothing to do with the session cap.

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
  "4-space" for those files — that instruction is stale. It leaves 5 errors it cannot auto-fix
  (`no-unsafe-*` and `unbound-method`, mostly in the specs); those are pre-existing, so a red
  `yarn lint` is not necessarily your change. Still: match the file you are editing rather than
  reformatting it.
- The frontend's `yarn lint` is `oxlint`, which only reports. It is clean.
