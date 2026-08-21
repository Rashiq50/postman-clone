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

### Profile edits

`PATCH /auth/me` and `POST /auth/change-password` back the `/profile` screen. Both take the
user id from `@CurrentUser()` only — there is deliberately **no `PATCH /users/:id`**, because
an id in the path is an authorization question these endpoints cannot even be asked.

- ⚠️ **An email change is re-authenticated; a rename is not.** The address is where a reset
  would be sent, so changing it is an account-takeover step and a live access token is not
  enough on its own — a borrowed unlocked laptop has one. Prompting for a password on a
  *rename* is what would make the prompt worthless: it trains the reflex to type a password
  into whatever asks. The check compares against the **stored** value (`changes.email !==
  user.email`), so a form resending an unchanged address does not trip it.
- ⚠️ **`@NormalizeEmail()` is on `UpdateProfileDto` too.** It is on `LoginDto` and
  `RegisterDto` for one reason — `findByEmail` is an exact match, so a stored address whose
  casing differs from what the user later types is a **silent permanent lockout** — and this
  is the one endpoint that can change an address after the fact, which makes it the easiest to
  forget and the worst to get wrong.
- ⚠️ **`currentPassword` carries no strength constraint**, only `MaxLength`. Running the policy
  on it would reject a password that was legal when set but is not now, locking the user out of
  the very screen that could replace it. `newPassword` runs the shared
  `StrongPasswordConstraint`.
- **The constraint moved to its own file**
  ([auth/dto/strong-password.ts](backend/src/auth/dto/strong-password.ts)) once
  `ChangePasswordDto` became its second caller. It was private to `register-dto.ts`; a copy in
  the second DTO is exactly the drift the shared `passwordProblem` exists to prevent.
- ⚠️ **A password change revokes the account's other sessions** via
  `revokeAllForUser(userId, { exceptSessionId })`. That is the point, not a bonus: the usual
  reason to change a password is believing someone else has it. `exceptSessionId` is
  `user.sessionId` from the token's `sid` — taking it from a body field or header would let a
  caller nominate which session survives their own password change. ⚠️ **The revocation runs
  after the hash is written**; in the other order a failed write signs the account's devices out
  for a change that never happened.
- ⚠️ **`changePassword` is its own endpoint, not a field on `PATCH me`** — see the note on
  `ChangePasswordInput` in contracts. Folding them together makes one request that *sometimes*
  signs your other devices out, invisible in the type.
- The duplicate email is **caught, not pre-checked**, in `UsersService.updateProfile` — the same
  unique index and the same `23505 → EMAIL_TAKEN` translation `register` uses, for the same
  race.
- The password check does **not** get `login`'s dummy-hash timing flattening. The caller is
  already authenticated and asking about their own password; there is no "does this account
  exist" left to leak.
- **There is no email verification**, deliberately, and the UI draws no affordance implying
  otherwise. The new address takes effect on save. That is the obvious next thing to build here
  and the seam is a column plus a token table.

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
- `tagTypes` is `Session`, `Me`, `Workspace`, `Tree`, `Request`, `Environment`, `Execution`.
  There is still deliberately **no `Collection` or `Folder` tag**: neither has a read
  endpoint — they exist only inside the tree — and a tag nothing provides makes the cache
  look covered where it is not. Each arrives with the feature that reads it, which is
  exactly how `Environment` and `Execution` arrived with Send.
- The access token is held **in memory only**, in `authSlice`. No `localStorage`, no
  `sessionStorage`, no `redux-persist`. A reload restores the session through the refresh cookie.
  Adding any persistence layer here is the thing to catch in review. (The theme preference is
  in `localStorage` — see *Theming*, and the sidebar's expansion set is too — see *Frontend
  workbench rules*. Those are display state, not credentials, and they are the only things
  this app stores.)
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
- ⚠️ **That mirroring is now structural, not a review rule.** Everything the two screens share
  outside their field lists lives in [AuthLayout.tsx](frontend/src/features/auth/AuthLayout.tsx)
  (the `lg:` split, the brand panel, the heading block, the footer link, the `ThemeMenu`) and
  [AuthField.tsx](frontend/src/features/auth/AuthField.tsx) (`AuthField`, `AuthCard`,
  `SubmitButton`, `FormError`). A visual change made to one screen's markup was the origin of
  every past divergence; there is no longer a one-screen place to make one. The glyphs are
  hand-written inline SVG in [AuthArt.tsx](frontend/src/features/auth/AuthArt.tsx) — same call as
  `NodeIcon`, no icon library. `AuthField` owns its own reveal state, which is what removed
  `RegisterPage`'s two copy-pasted `showPassword` pairs.
  - The brand panel is `hidden lg:flex`: on a phone it would push the form below the fold, and
    the form is the only reason anyone is on the screen.
  - ⚠️ Every colour is still a token, including the panel's sample-request preview (it reuses
    the `method-*` and `success-soft` pairs `yarn contrast` already audits), so the facelift
    added **no token and no `PAIRS` entry**. A palette utility here would pin the first screen
    anyone sees to light mode.
  - The card takes `glass`, not `glass-tint`: the canvas wash passes behind it and nothing
    `position: fixed` lives inside it, which is the pair of conditions *Theming* sets for
    spending a backdrop blur.
- **The header is the brand, the workspace switcher, the environment picker, and two menus.**
  [AppHeader](frontend/src/features/auth/AppHeader.tsx) keeps only what is *about the workspace
  you are looking at*; the rest is [ThemeButton](frontend/src/features/theme/ThemeButton.tsx)
  and [UserMenu](frontend/src/features/auth/UserMenu.tsx). The nav pair (Workspace/Sessions) is
  gone: the workspace is home, and Sessions is a sub-page of Profile.
  - ⚠️ **The header row is always full width; the `wide` prop is gone.** It used to inherit
    `AppShell`'s centred `max-w-3xl` column, so moving from the workbench to `/profile` narrowed
    the chrome and slid the brand and the controls inward — the app's frame appearing to resize
    around a page change. The frame is the frame; only `<main>` centres. Reintroducing the prop
    brings the jump back.
  - ⚠️ **`WorkspaceSwitcher` and `EnvironmentPicker` both render nothing without a
    `:workspaceId`.** They describe the workspace you are looking at, and on `/profile` there is
    none — the switcher previously fell back to its `placeholder` there, which reads as a
    workspace having failed to load rather than as one not being relevant. The two guards are
    now the same line for the same reason; keep them that way.
  - ⚠️ **The theme is its own icon button, not an item in the account menu.** It is per browser,
    not per account, so it is not an account setting — and it is changed far more often than
    anything under a user's own name should be buried. Its rows carry each theme's `hint` as a
    second line (the strings `ThemeMenu`'s `Select` shows on the auth pages), because "Glass"
    and "Midnight" tell a first-time reader nothing on their own. A sun/moon glyph would be
    wrong on the trigger: five themes across two appearances is not a binary toggle.
  - ⚠️ **`UserMenu` lists Profile and Sign out — not Sessions.** Sessions is one click away
    inside `/profile`'s own sub-nav, and listing it here too made the menu a second, competing
    navigation for the same pages: the one that silently goes stale when a third sub-page
    appears.
  - **Both menus share [Menu.tsx](frontend/src/components/ui/Menu.tsx)**, so their keyboard
    behaviour cannot diverge. ⚠️ It is hand-written and must not become
    `@radix-ui/react-dropdown-menu` — a *fourth* Radix package, against the rule above that
    nothing is added on the strength of "we already have Radix". What it would buy (Escape,
    outside-press, focus restore, roving arrow keys) is the ~70 lines there, shared by both.
    (`NodeMenu` stays separate: it is hand-written for a *different* reason — thousands of
    instances, a `fixed` panel escaping the sidebar's clip — and folding it in would drag that
    positioning problem into a component that does not have it.)
  - ⚠️ `Menu`'s panel is **`absolute`, not `fixed`** — the opposite of `NodeMenu`'s. The header
    is not a scroll container, so there is no clip to escape. The header's `glass` does not
    interfere: a `backdrop-filter` makes an element a containing block for `fixed` descendants,
    not for absolute ones.
  - ⚠️ **Focus returns to the trigger on every close**, Escape included — not only on selecting
    an item. The exception is an outside click, which moves focus itself; restoring there would
    yank it back from whatever the user just clicked.
  - ⚠️ **Items are found by role from the DOM**, not passed as a model. That is what lets one
    call site render `menuitem` buttons and the other `menuitemradio` rows with no shared item
    type, and it makes an arrow-key order that disagrees with the visual order unrepresentable.
  - ⚠️ The `resize` listener is a **named** handler. `removeEventListener` compares by identity,
    so an inline arrow is added on every open and never removed.
- **`/profile` and `/profile/sessions`**, under `AppShell`, with
  [ProfileLayout](frontend/src/features/profile/ProfileLayout.tsx) owning the `h1` and the
  sub-nav. ⚠️ The sub-nav is `NavLink`s, not local tab state: these are two **locations**, so
  Back must return from Sessions to Account. That is the opposite of `RequestEditor`'s
  Params/Body call, and for the opposite reason. `SessionsPage`'s own heading dropped to an
  `h2` — two `h1`s make the outline lie.
  - ⚠️ **`/sessions` is kept as a redirect, not deleted.** It is the one route a user is likely
    to have bookmarked, and the `*` catch-all would otherwise land them on the workspace with no
    hint that their link moved.
  - ⚠️ **Three forms on `/profile`, not one.** Two endpoints, two different consequences, and
    only one of them re-authenticates; a single Save would either demand a password to rename
    yourself or skip the check that matters, and its success message could not say which of the
    three things happened. The email card renders its password field **only while the address is
    actually changing**.
  - Each card seeds from `selectCurrentUser` and reseeds on the **value**, never the object —
    `useEffect(..., [current])`. The selector hands back a new reference on every refetch, and
    reseeding on that wipes what the user is typing: the trap `useRequestDraft` already records.
  - `passwordProblem` is imported from contracts here too, for the same reason `RegisterPage`
    imports it — the form cannot drift from the DTO.
  - `updateProfile` feeds `authSlice` through `onQueryStarted` **and** invalidates `Me`. Not
    redundant: the slice is the synchronous copy the header renders, the tag is the cache. A
    rename that only invalidated would leave the old name in the header until something
    refetched, which reads as a save that silently failed.
  - ⚠️ `changePassword` invalidates `Session` (the list next door is showing devices that were
    just signed out) and deliberately does **not** touch `authSlice` — the server spares the
    caller's session, so a `loggedOut()` here would sign the user out of the change they just
    made.
- **The form primitives moved to [Field.tsx](frontend/src/components/ui/Field.tsx)** — `Field`,
  `SubmitButton`, `FormError` — when `/profile` became the third screen to need them, which was
  the stated condition for promoting them out of `features/auth`. `AuthCard` stayed behind: it
  is the auth card and nothing else. They are not generic form infrastructure; a prop added here
  to serve one call site is the signal that that call site wanted its own component.
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
- **The workspace id lives in the URL, not Redux.** Nothing is persisted in Redux at all, so
  an id there does not survive a reload and every refresh would silently pick "the first
  workspace" — invisible until a user has two.
- ⚠️ **Because the id is in the URL it outlives the session that produced it, so `WorkspaceGuard`
  wraps `w/:workspaceId` and bounces an id the signed-in user does not own back to `/`.** The
  path that needs it: signing out sends `RequireAuth` to `/login` with
  `from = /w/<previous user's workspace>`, and `LoginPage` navigates to `from` after *whoever*
  signs in next — so user B lands on user A's URL and every request 404s. The guard sits above
  `WorkbenchShell` so the sidebar never mounts against a foreign id, and it lets the route
  through when the workspace list itself failed to load (a failed list is not evidence the id is
  wrong, and `/` would hit the same failure).
- **The sidebar cache is patched, not refetched.** Every structural mutation writes the change
  straight into the cached `WorkspaceTree` from its `onQueryStarted`, via the pure helpers in
  [treeCache.ts](frontend/src/features/tree/treeCache.ts) and the two dispatch wrappers in
  [treePatch.ts](frontend/src/features/tree/treePatch.ts). A refetch of the whole workspace after
  every rename/move/delete is a visible stall once a workspace has hundreds of collections.
  - **Optimistic** (patch first, then send): rename, delete, move/reorder, and a request's
    `method`. **Response-patched** (await `queryFulfilled`, insert the returned DTO): the three
    creates — they need the server's `id` and `position`. No temp-id inserts; deliberate.
  - ⚠️ **Two rollbacks, on purpose.** Rename does `patch.undo()`. Structural ops instead
    `invalidateTags(treeTag(ws))` — an `undo()` applied after other patches, or after a focus
    refetch swapped the cache object, can mis-apply, and the error path is where one full fetch
    is fine.
  - ⚠️ **The helpers are total and silent**: a missing id is a no-op, never a throw. A stale
    cache is legitimate (another tab, another member) and the reconcile is what fixes it.
  - ⚠️ **Array order is the render order; nothing re-sorts on `position`.** `positionForMove`
    renumbers a whole sibling set when the 1024 gap runs out, so patched positions go stale while
    the order stays right. Move splices by index.
- **One `Tree` tag per workspace, and it still exists** — now serving exactly two jobs: the
  error-path resync above, and the focus reconcile below. ⚠️ **Every mutation argument still
  carries `workspaceId` even though the server ignores it** — it is no longer the invalidation
  key but the *patch* key, since `updateQueryData` needs the exact query argument. Forgetting it
  presents as "the sidebar doesn't update until I reload".
- ⚠️ **`updateRequest` patches the tree only when `name` or `method` is in the changes**, and
  keeps its `Request:id` invalidation always. Those two fields are all the sidebar renders; every
  other save (a header, a body, a script) must not touch tree state at all.
- **Tabs converge on focus, never by push.** `setupListeners` is called in `app/store.ts` and
  `getTree` alone opts into `refetchOnFocus` / `refetchOnReconnect` (per-endpoint, at the hook in
  `Sidebar` — not globally, or the request editor's draft behaviour changes too). An edit in tab A
  appears in tab B when B is next focused. **No `BroadcastChannel`, no `storage` events, no
  socket** — same doctrine as auth, and nothing new in `localStorage`.
- ⚠️ **`useRequestDraft` keys its seeding effect on `request?.id`, never `request`.** RTK Query
  returns a new object identity on every background refetch, so depending on the object wipes
  whatever the user was typing — intermittent, and presents as a dropped keystroke. There is no
  autosave either: autosave plus a tree that invalidates on renames is a refetch storm.
- **The URL bar and the Params table are two views of one query string**, synced both ways by
  the pure helpers in [urlQuery.ts](frontend/src/features/requests/urlQuery.ts). The URL text is
  canonical: typing in the bar re-derives the table (a positional merge that preserves disabled
  rows — they exist only in the table); editing the table rewrites only the URL's query section.
  Each direction is a single `patch` inside its own event handler — **no effect watches one side
  to write the other**, which is what makes a parse→serialize feedback loop (rewriting the bar
  under the caret) structurally impossible. Parsing is plain string splitting, never `new URL()`
  (`{{variables}}` fail it) and never percent-decode/encode (`encodeURIComponent` mangles `{{`).
  - ⚠️ **`runSend` passes `queryParams: []`, explicitly.** Every enabled row is already in
    `draft.url`, and the server *appends* the table it receives onto the URL's own query — so
    sending the rows doubles every param. It must be `[]`, not omitted: `undefined` falls back
    to the *stored* rows server-side (`draft.queryParams ?? stored.queryParams`) and doubles
    them just the same.
  - ⚠️ **`toDraft` seeds through `seedUrl` + `paramsFromUrl`.** A request saved before the sync
    holds params only in the table; seeding the bare stored URL would display a URL missing them
    and the first keystroke in the bar would then re-derive the table and silently wipe them.
    `seedUrl` matches by whole `key=value` pair (a multiset), so re-opening a post-sync request
    does not grow its URL. Baseline is built from the same seed, so seeding never reads as dirty.
- **The request editor's chrome states what the draft is doing, because nothing else can.**
  With no autosave, a saved request and an edited one look identical otherwise — and Send
  makes that *more* pressing, not less, since Send deliberately fires the draft. So
  the header carries a `role="status"` dirty pill (`Saving…` / `Unsaved changes` / `Saved`,
  `isSaving` tested *first* — a request stays dirty until its response lands), and each tab
  carries a badge built from the draft: a count of the *enabled and non-blank* rows for Params
  and Headers, a dot for Body / Auth / Scripts. ⚠️ The badges read
  `group-data-[state=active]` off the Radix trigger rather than taking an `isActive` prop —
  the trigger already owns that state, and a prop is a second copy that can disagree.
- **The breadcrumb subscribes to `getTree`; it does not fetch it.** `requestPath` in
  [requestPath.ts](frontend/src/features/tree/requestPath.ts) walks the cached tree for the
  *names* of a request's ancestors (`ancestorsOf` in `treeCache.ts` answers with ids, for cache
  patches). The sidebar is mounted beside the pane, so this is a second subscriber to one
  response — and it must **not** opt into `refetchOnFocus`, which belongs to the sidebar's hook
  alone. ⚠️ Its row holds `h-4` whether or not a path is drawn: the tree can arrive after the
  request does, and a breadcrumb appearing late would shove the title down under the caret.
- **The tab panel is a `bg-surface` card on `bg-canvas`**, not content laid straight onto the
  canvas. Besides separating chrome from content it puts every label back onto `surface`, which
  is the background `PAIRS` in `check-contrast.mjs` actually audits the foreground tokens
  against — `fg-faint on canvas` is not a checked pair. Loading is a skeleton of that same
  layout rather than a line of text: opening a request is the most frequent navigation in the
  app, so a pane that blanks is a flicker seen dozens of times an hour.
- ⚠️ **`NodeMenu` is `position: fixed` from `getBoundingClientRect()`, and flips above its row
  when there is no space below.** The sidebar is an `overflow-y-auto` container, so an
  absolutely-positioned menu on a bottom row is clipped and invisible; escaping that clip then
  lets it run off the *viewport*, which hides the bottom items just as well. Both halves are
  needed — the second was found by running the app, not by reading it.
- ⚠️ **The sidebar's view state is an external store, not React state.**
  [treeUi.ts](frontend/src/features/tree/treeUi.ts) holds expansion (one `Set`), the node being
  renamed and the active request id, and each row subscribes for itself with
  `useSyncExternalStore`. This is purely about render cost and is the whole reason `useExpanded`
  is gone: with thousands of mounted rows, any of those three values held in `Sidebar` re-renders
  *every* row on every chevron click, because whatever prop or context carries the value down
  changes identity and defeats `React.memo` on everything in between. The store's identity never
  changes, so a toggle re-renders the toggled row and the subtree it mounts, and nothing else.
  It is still not Redux (an action per chevron click for state nothing outside the sidebar reads).
- ⚠️ **Expansion — and only expansion — is persisted**, per workspace, under
  `pc.tree.expanded.<workspaceId>` in `localStorage`
  ([treeExpansion.ts](frontend/src/features/tree/treeExpansion.ts)). Renaming and the active
  request stay in memory: the first is a transient mode, the second already lives in the URL.
  - ⚠️ **It is read during the render that creates the store, never in an effect.** An effect
    runs after the first paint, so the tree would paint collapsed and then pop open — the same
    one-frame flash the theme's inline script in `index.html` exists to avoid.
  - **Writes are debounced (250ms) and coalesced**; a chevron click is a `Set` mutation plus a
    notify, never a synchronous `JSON.stringify` + `setItem`. `useTreeUiStore` flushes on
    unmount and on `pagehide`, so the last toggle before a close is not lost.
  - ⚠️ **The set is capped at 2000 ids, not pruned against the tree.** Deleted nodes' ids are
    never cleaned by anything else, and walking every node on each cache patch is exactly the
    cost Phases 1–3 removed. A stale id is inert — `isExpanded` answers true for a row that no
    longer renders. `toggle` re-inserts on open so insertion order is recency and the cap drops
    the head.
  - ⚠️ **The store is rebuilt when `workspaceId` changes**, since `Sidebar` is not remounted
    across workspaces; a store built once would persist workspace A's set under A's key while
    showing B. Every storage access is inside a `try`/`catch` — Safari's private mode throws on
    `setItem` and the sidebar must degrade to forgetting, not to breaking a click.
- ⚠️ **The three node views are `React.memo`'d and their props must stay referentially stable.**
  `Sidebar` builds the `TreeHandlers` object with `useMemo` over stable deps only; `tree` and
  `requestId` reach `menuFor` through a **ref**, because closing over them would give `handlers` a
  new identity on every refetch and every navigation — which re-renders every row and undoes the
  memoization entirely. A row's slot among its siblings is passed as `index` + `siblingCount`,
  never as the sibling array: a patch gives every array on the path to it a new identity, so an
  array prop would fail the memo comparison on all 500 collection rows for an edit inside one.
- ⚠️ **`NodeMenu` takes a `getItems` thunk, not a `MenuItem[]`,** and calls it when the ⋯ button
  opens. Building the array during render meant one allocation per mounted row per render for a
  menu at most one row has open, and it dragged the whole tree into each row's memo equation.
  Reorder gets the node's current parent from `MenuContext.parentId` (i.e. from the node itself)
  rather than by walking the tree for it.
- **Radix is a behaviour-only dependency.** `@radix-ui/react-dialog`,
  `@radix-ui/react-tabs` and `@radix-ui/react-select` — unstyled primitives that ship a focus
  trap, Escape and outside-press handling, scroll lock, focus restore, roving arrow-key focus,
  listbox typeahead, popper collision flipping and the ARIA wiring. ⚠️ **They
  ship no colours, and that is the entire reason they are allowed**: every pixel is still a
  semantic token, so `yarn contrast` still audits these surfaces and another theme is still one
  CSS block. **A styled kit (MUI, Ant) is the thing to reject in review** — it brings a second
  theming engine (emotion palette, cssinjs tokens) whose components sit outside the CSS that
  `check-contrast.mjs` parses, which turns "unchecked" into "unchecked and invisible".
  - Modal styling lives in **one** file, [Dialog.tsx](frontend/src/components/ui/Dialog.tsx), not
    at the call sites — that is what keeps "we use Radix" from meaning "every dialog picks its
    own padding and overlay", and it is the seam that makes replacing the primitive one edit.
  - ⚠️ **No `window.prompt` or `window.confirm` anywhere.** Both are
    [PromptDialog](frontend/src/components/ui/PromptDialog.tsx) and
    [ConfirmDialog](frontend/src/components/ui/ConfirmDialog.tsx) now — the sidebar's three
    creates and its delete, the request editor's unsaved-changes guard, and revoking your own
    session. The reason is not that the native ones are ugly: they **block the main thread**, so
    an optimistic patch that has already been dispatched cannot paint until the user answers, and
    a user who ticks Chrome's "prevent this page from creating additional dialogs" gets a `null`
    or `false` for ever after — New folder and Delete then silently do nothing, with no error
    anywhere. A `grep` for either in `frontend/src` should only ever hit those two files' prose.
  - ⚠️ **`ConfirmDialog` calls `onConfirm` before `onClose`, and callers depend on the order.**
    `Sidebar` reads whether a delete orphans the open request *first*, because the optimistic
    patch removes the subtree and asking afterwards always answers "no". `RequestEditor` needs
    the opposite guard: the `blocker` captured in the dialog's closure still reads `'blocked'`
    after `proceed()` has run, so a `proceeded` ref stops `onClose` from calling `reset()`
    straight after — which would cancel the navigation and look like a dead button.
  - **The prompt/confirm state in `Sidebar` holds callbacks**, and `setPrompt`/`setConfirm` are
    stable setters, so `handlers` stays memoized and no row re-renders when a dialog opens.
  - `--on-danger` was added to every theme for the destructive button (white fails on the
    dark themes' lighter red, exactly as with `--on-accent`), plus two `PAIRS` entries — a token
    not in `PAIRS` is unchecked, not passing.
  - ⚠️ **`Dialog` restores focus itself and must keep doing so.** Call sites mount it
    conditionally (`{state && <MoveToDialog/>}`), and Radix restores focus from
    `onCloseAutoFocus`, which never runs when the tree is unmounted in the same tick that closes
    it — focus lands on `<body>`. It captures `document.activeElement` on mount and refocuses on
    unmount, in a `setTimeout` so it does not race Radix's teardown. Found by driving the app;
    invisible to any test that does not assert on `document.activeElement`.
  - ⚠️ Relatedly, **`NodeMenu` focuses its `⋯` synchronously before running an item's
    `onSelect`.** The clicked menu item unmounts, so without it focus is already on `<body>` by
    the time a dialog opens and there is nothing to restore to.
  - **Every dropdown is [Select.tsx](frontend/src/components/ui/Select.tsx)** — the workspace
    switcher, the theme picker, the method picker, body mode, auth type and auth placement. One
    file, same seam argument as `Dialog`. It takes flat items or groups, an optional `hint`
    second line (the theme picker's, which a native `<option>` could only carry as a `title`
    tooltip nobody finds) and a per-item `className` (the method colours, which an `<option>`
    ignores outright).
    - ⚠️ **Pass `undefined`, never `''`, for "nothing selected"** — Radix reserves the empty
      string, and an unmatched value renders a blank trigger with no placeholder.
    - ⚠️ `position="popper"`, not the default `item-aligned`, which tries to put the selected row
      over the trigger and pins a long list against a viewport edge. Height is capped with
      `--radix-select-content-available-height`; a fixed `max-h` clipped the last hint line.
    - `data-[highlighted]` (keyboard *and* pointer focus) and `data-[state=checked]` (the current
      value) are different things and both are styled. Highlighting only the checked row makes
      arrowing through the list invisible.
  - ⚠️ **No native `<select>` inside a themed surface.** `<option>` rows are painted by the
    platform: Chrome renders them opaque white whatever `background-color` and `color-scheme`
    say, so the move dialog's sized `<select>` was a white slab on Dark and Midnight — the only
    element in the app that ignored the theme. `MoveToDialog` uses a `role="listbox"` of divs
    with arrow/Home/End/Enter handling instead. (The header's one-line `<select>`s are fine —
    the closed control *is* styleable; it is the open list that is not.)
  - ⚠️ **A move target's identity is the pair (collection, folder), never the folder id.** Every
    collection root has `id: null`, so keying on the id alone selects all of them at once — and
    pre-selected collection 1's root for a request living in collection 300, one Enter from a
    silent cross-collection move. `MoveTarget` carries `depth` for indentation now too, instead
    of leading spaces baked into `label` (a workaround for `<option>` being unstylable).
  - ⚠️ **`NodeMenu` stays hand-written and must not become a Radix `DropdownMenu`.** A Radix
    root and trigger would mount *per row*, and thousands of rows are mounted at once — the same
    cost the `getItems` thunk exists to avoid. Its `getBoundingClientRect` positioning and
    above/below flip are already the solved case.
  - The cost is recorded so it can be judged later: the three packages are **+101 kB raw /
    +33 kB gzip** over the pre-Radix baseline (dialog + tabs +53/+18, select a further +46/+15,
    the prompt/confirm wrappers +2/+0.4).
    The native controls they replaced were keyboard- and screen-reader-correct for free; that
    correctness now rests on Radix rather than on the browser. Nothing else may be added on the strength of "we already have Radix" — each package
    is its own decision.
- **No icon library**, still — a text glyph for the kebab (`⋯`). The glyphs in [NodeIcon.tsx](frontend/src/features/tree/NodeIcon.tsx) are
  hand-written inline SVG for the same reason, drawn in `currentColor` only — a baked-in hex
  would be the one thing on the page that ignores the theme.
  - **A folder is a folder** (open when expanded). **A collection has no icon**: an archive box
    lived there once and was removed — depth 0 already identifies a collection, and a second
    container glyph beside the folders' only crowded the gutter. A request has none either, its
    method label being its marker.
  - **The chevron is `ChevronIcon`, one outline path rotated 90° by CSS**, not the `▸`/`▾` text
    glyphs it replaced: at `text-xs` those rendered ~8px of ink, too small to read as a control,
    and two swapped glyphs cannot animate. ⚠️ Its button is `w-5` and `RequestNodeView` renders
    an empty `w-5` spacer in the same slot — a request has no children but its label must line
    up with its sibling folders'. Those two widths change together, plus the `pl-[40px]` on the
    collection view's "Empty" line.
  - ⚠️ The folder icon renders **inside** `NodeRow`'s label button, which is therefore a flex
    row: the label needs its own `truncate` span, since `truncate` on the button no longer
    reaches it.
- **Send is the primary action of the URL bar**, to the left of a now-secondary Save. It is
  ⚠️ **not gated on `isDirty` and it sends the draft**: there is no autosave, so gating it
  on a clean draft makes the pane feel broken, and firing the last *saved* request while the
  user looks at their edits is the most confusing behaviour available. The server records
  `usedDraft`. See the Send section below.
- Login and register default their post-auth `from` to `/`, the workbench.

## Send

`POST /requests/:id/send` is the execution engine, in `backend/src/execution/`. The layers
are `interpolate.ts` → `ssrf.ts` → `http-client.ts`, each pure or nearly so and each with a
spec; `execution.service.ts` orchestrates them and `executions.service.ts` records the run.

**⚠️ The one idea that shapes everything: a failed upstream request is not an API error of
ours.** `/send` answers **200** whether the target returned 200, returned 500, refused the
connection, or was blocked before a socket opened. The result is a union discriminated on
`outcome`. Our error envelope is reserved strictly for *our* failures: a malformed DTO
(400), a request not visible (404) or a role too low (403), an environment not visible
(404), a rate limit (429), an unexpected throw (500). Collapsing upstream failures into
`ApiException` would make a 500 from the target indistinguishable from our own backend
crashing, would force the client to branch on our HTTP status, would mean the response pane
could never show a 4xx body — which is most of what a person presses Send to look at — and
would make history and the live pane need two renderers for one concept. There are
deliberately **no new `ApiErrorCode`s**; `error.ts` records why.

**Sending is a read-like act**: the request is loaded with `READ_ROLES`, so a VIEWER may
send. They can already read the URL and the plaintext bearer token out of `GET /requests/:id`,
so refusing them leaks nothing and buys nothing; the egress concern is answered by the SSRF
policy and the per-user throttle, not by the role table. Clearing history is `WRITE_ROLES`
— it destroys shared data. Reversing either is one constant.

### Traps

- ⚠️ **Screening and connecting must be one act.** `resolveAndScreen` returns addresses and
  the connection is pinned to one via a `lookup` function passed through `http.request`.
  Screening a *hostname* and letting Node re-resolve it is a DNS-rebinding hole that passes
  every hand test, because the attack needs a second query to fire. The `lookup` route also
  keeps SNI and the `Host` header derived from the hostname, so TLS verification stays
  correct — setting `host: <ip>` by hand is what breaks it. A `connect`-time assertion that
  `socket.remoteAddress` equals the pin is the belt-and-braces that catches a refactor
  dropping the `lookup`.
- ⚠️ **Every redirect hop re-screens and re-pins.** The first hop's clearance says nothing
  about the second's.
- ⚠️ **A cross-origin hop strips `Authorization`, `Cookie` and `Proxy-Authorization`.**
  Forwarding a bearer token to whatever host a redirect names is a credential-exfiltration
  primitive, and it is the default behaviour of every naive implementation.
- ⚠️ **`::ffff:127.0.0.1`, `64:ff9b::7f00:1`, `2002:7f00:1::` and `http://2130706433/` all
  reach loopback.** The v6 forms are unwrapped and re-checked as IPv4; the decimal, octal
  and hex v4 forms are safe only because `url.hostname` is what gets screened, never the raw
  input (`new URL()` normalizes them). Node normalizes `::ffff:127.0.0.1` to the **hex**
  form `::ffff:7f00:1`, so the unwrapping has to handle that spelling too.
- ⚠️ **`url.hostname` keeps the brackets on an IPv6 literal** (`"[::1]"`) and `net.isIP`
  answers `0` for the bracketed form. Strip them before the literal check or the whole IPv6
  table is dead code reached by nothing — it fails *closed*, as `dns`, which is exactly why
  it is easy to miss.
- ⚠️ **Interpolation is a header-injection vector.** A saved request is authored by a human,
  but `{{token}}` can carry CRLF straight out of an environment variable. Names and values
  are validated *after* substitution and before the socket; do not lean on Node's
  `ERR_INVALID_CHAR` being the security boundary.
- ⚠️ **A substituted value is never rescanned**, which is what makes `{{a}}` → `{{b}}` inert
  and closes recursion and expansion bombs in one stroke. The cost — a literal `{{token}}`
  is unrepresentable, there being no escape syntax — is accepted and documented, not an
  oversight.
- ⚠️ **A disabled variable row is dropped *before* the merge**, or it shadows an enabled row
  of the same name in a lower-precedence scope. Presents as "my variable stopped working
  when I unticked the other one".
- ⚠️ **An unresolved `{{name}}` is left in place literally and warns.** Never the empty
  string: `{{baseUrl}}/users` becoming `/users` is a request against a *different host* that
  may well succeed. In the URL it self-enforces — `new URL()` fails and the send ends as
  `invalid-url`, the loud failure exactly where it matters.
- ⚠️ **The response cap is on *decompressed* bytes.** Sends ask for `identity`; if the
  target compresses anyway, zlib's `maxOutputLength` plus a byte counter is what makes the
  cap real. **Overflow is a success, not a failure** — the status line already arrived and
  is the useful part.
- ⚠️ **`buf.toString('utf8')` always "succeeds"** (it substitutes U+FFFD), so it cannot be
  the text-vs-binary test; `TextDecoder('utf-8', { fatal: true })` is. **And that is still
  not enough — NUL is valid UTF-8**, decodes cleanly, and Postgres then rejects it in a
  text/jsonb column, turning a good send into a 500 on the history insert. Decoded text
  containing a NUL byte falls to base64 too, and response *header* values get the same
  treatment before they land in jsonb.
- ⚠️ **Node drops a request body on GET/HEAD/DELETE/OPTIONS unless `Content-Length` is
  set** — `useChunkedEncodingByDefault` is false for those methods, so an unframed body is
  silently discarded. The transport sets the header itself, which is what makes "send a body
  on a bodyless method verbatim, and warn" actually true rather than merely intended. Found
  by a failing test, not by reading.
- ⚠️ **A failed history insert must not fail the send.** The request already left the
  building; a 500 here tells the user their send failed when it did not, and invites a retry
  that fires the upstream call twice.
- ⚠️ **The environment must be confirmed to belong to the *request's* workspace**, not
  merely to be visible to the caller — a member of two workspaces could otherwise inject
  workspace B's variables, and so B's base URL and credentials, into a send from workspace A.
- ⚠️ **`workspace_members.activeEnvironmentId` is `ON DELETE SET NULL`.** `CASCADE` deletes
  the *membership row* — a user evicted from a workspace because someone tidied up an
  environment, with no invite endpoint to repair it. `RESTRICT` would make an environment
  undeletable while anyone had it selected.
- ⚠️ **The active-environment `UPDATE` is keyed on `("workspaceId","userId")`, not on a row
  id.** Copying the `"id" = :id` spelling from the other services rewrites *every* member's
  preference in the workspace.
- ⚠️ **Tests override the `SEND_OPTIONS` provider, never `process.env`** — `ConfigModule`
  reads and validates at decorator-evaluation time, the trap already recorded for
  `THROTTLER_OPTIONS`. Not theoretical: the e2e fixture listens on `127.0.0.1`, which the
  real policy blocks. **The screening predicate is itself part of `SendOptions`**, and that
  is what makes the suite expressible at all: one override allows `127.0.0.1` (the fixture)
  while blocking `127.0.0.2` (a marker with nothing bound to it), so allowed and blocked
  addresses coexist in one suite and the redirect test can have hop 1 pass and hop 2 fail.
- ⚠️ **`request_executions` is a third plaintext-secrets store.** Sent request headers are
  deliberately *not* stored, which is what keeps the freshly built `Authorization` header
  out of it entirely; do not "complete" the row with the most secret-laden column in the
  feature.
- ⚠️ **`min-h-0` on the editor's new split container** as well as on both of its children,
  or the whole editor scrolls instead of the panes — and `<main>` already scrolls, so the
  symptom is a second scrollbar rather than an obvious break.
- ⚠️ **A `failure` outcome renders no status pill at all.** A `0` or `—` where a status code
  goes is the exact confusion the two-outcome contract exists to prevent.
- ⚠️ **The history pane needs its "viewing a past run" banner.** Without it a user clicks a
  history row, sees a body, and believes their last Send returned it — the same class of bug
  as the Scripts banner.
- **The pane's header carries three icon buttons — copy, download, clear** —
  in [ResponseActions.tsx](frontend/src/features/requests/ResponseActions.tsx), with the pure
  half (`downloadResponse`, `contentTypeOf`, `headersAsText`, the extension map) split into
  [responseFile.ts](frontend/src/features/requests/responseFile.ts). ⚠️ The split is not
  taste: a module exporting both components and plain functions breaks fast refresh for the
  whole file, and `oxlint`'s `only-export-components` is the warning that catches it. The
  frontend lint is clean and stays clean.
  - ⚠️ **They act on what is rendered, never on `result`.** The pane also shows stored runs,
    so a Copy reading the live send while the user looks at a past one is the same bug the
    "viewing a past run" banner exists to prevent. Everything is derived from the one
    `ResponseView`.
  - ⚠️ **That is why the Pretty/Raw toggle moved up into `ResponsePane`.** `BodyView` is now
    controlled. A toggle owned by the view would leave Copy handing over raw text while the
    reader sees prettified — which looks like a broken formatter, not a broken Copy.
  - **Copy follows the active tab**: the displayed body on Body, `Name: value` lines on
    Headers, `kind: message` for a `failure` (what a person pastes into a bug report), and
    nothing on History. Disabled rather than hidden — buttons that come and go on a tab
    change make the header jump.
  - **Clear discards both sources at once** (`setHistoryId(null)` *and* `resetSend()`), and
    destroys nothing server-side — the run is still in History. Clearing one and not the
    other leaves the pane showing something and reads as a dead button.
  - ⚠️ The binary body keeps its own large Download button beside the toolbar's. Both call
    `downloadResponse`, so the duplication is in the affordance only: for a binary response it
    is the single available action, and a 14px glyph is not where the reader will look.
  - ⚠️ `navigator.clipboard` is undefined on an insecure origin and refusable by permissions
    policy, so the copy is wrapped and reports "Could not copy" rather than doing nothing. The
    tick is a visual confirmation only — the `role="status"` line beside it is what a screen
    reader gets, and the reset is a `setTimeout` cleared on unmount (navigating away while it
    is up unmounts the button mid-flight).
  - The glyphs are hand-written inline SVG in `currentColor`, like `NodeIcon` and `AuthArt`,
    and every button carries both `aria-label` and `title` — no tooltip library, same call
    `NodeMenu` makes about a dropdown library.

### Throttling, revisited

`ThrottlerModule.forRootAsync` now lives in **one** place,
[throttling.module.ts](backend/src/common/throttling/throttling.module.ts), imported by both
`AuthModule` and `ExecutionModule`. ⚠️ Registering it twice would give two independent
storages, and therefore a counter that silently allows double what it says. Four named
windows are registered together (`burst`, `sustained`, `sendBurst`, `sendSustained`) and
each route opts out of the pair that is not its own with a per-name `@SkipThrottle`; a skip
entry for an unregistered name no-ops, which is why the three existing e2e overrides had to
grow to the four-window shape in the same change — otherwise the suites and production
configure different universes. `SendThrottlerGuard` keys on `request.user.userId` rather
than `req.ip`: every caller here is authenticated, and `req.ip` is the *proxy's* address, so
per-IP would collapse every user into one bucket.

### Retention

Two policies. The per-request cap (`SEND_HISTORY_PER_REQUEST`) is enforced **inside the
insert's transaction, after the insert, as one set-based statement** — the shape
`MAX_SESSIONS_PER_USER` already uses. ⚠️ `id` is the tiebreaker in its `ORDER BY` because
two sends inside one millisecond otherwise make the ordering non-deterministic and the
delete non-idempotent. The age sweep, `deleteExpiredExecutions()`, is **implemented,
unit-tested and deliberately uncalled** — a cron hook point, exactly like
`deleteExpiredSessions()`. `@nestjs/schedule` is still not a dependency and this slice did
not make it one.

## Syntax highlighting

Two consumers, **two different answers, and the split is the whole point**: colour for
reading is a tokenizer, colour for *typing* is an editor, and only the second is worth a
dependency.

- **The response pane highlights with no dependency at all.**
  [jsonSyntax.ts](frontend/src/features/requests/jsonSyntax.ts) is a ~120-line hand-written
  JSON scanner returning `{ kind, text }` tokens, which `BodyView` renders as `<span>`s. It
  is **total** — it never throws and never rejects, so a body that stops being valid JSON
  halfway through still renders in full, just with less colour after the break.
  - ⚠️ **`prettify` is the single "is this JSON?" test**, and its answer is threaded down as
    `canPretty` to gate the Pretty/Raw toggle *and* the highlighting. Deriving that answer
    twice is how the two would come to disagree — a body prettified but uncoloured.
  - ⚠️ **`plain` tokens (whitespace, anything unrecognised) render as bare text nodes, not
    `<span>`s**, and adjacent same-kind spans are merged in a second pass. Indentation is by
    far the most common token in a prettified document; wrapping it would roughly double the
    node count to colour nothing.
  - ⚠️ **`HIGHLIGHT_MAX_CHARS` (100 kB) is the whole performance story, and it is not about
    the scanner** — which does 423 kB in ~18ms and is linear. It is about React reconciling
    and the browser laying out one span per token: 100 kB of prettified JSON is ~20,000
    spans. Over the cap the pane renders the plain `<pre>` **and says so**; degrading
    silently would read as "this response was not recognised as JSON", a lie about the data
    rather than a statement about its size.
  - ⚠️ **The `useMemo` sits above `BodyView`'s early returns.** An `empty` or `base64` body
    returns before the `<pre>`, so a hook below them changes the hook order between two
    responses — a bug that only fires on the *second* send. It is memoized because the pane
    re-renders on every pointermove while the split handle is dragged.

- **The request body uses CodeMirror 6**, in
  [CodeEditor.tsx](frontend/src/components/ui/CodeEditor.tsx) — the app's one editor
  dependency and its largest single one. A body is typed into, and keeping a highlight layer
  in register with a caret, a selection, wrapping and IME composition is the part not worth
  hand-writing: a transparent `<textarea>` over a mirrored `<pre>` desynchronises on wrap and
  on composition and presents as *the app dropping keystrokes*.
  - **Monaco was considered and rejected**: ~1 MB gzip against CodeMirror's ~120, a worker
    build, and — decisively — it defines its themes in JavaScript, which would put every
    syntax colour outside the CSS `check-contrast.mjs` parses. Same "unchecked, and invisible
    because it is unchecked" objection as a styled component kit.
  - ⚠️ **The cost is recorded, as Radix's is: six packages, +311 kB raw / +102 kB gzip**
    (565.76/176.91 → 877.12/279.25 on `yarn build`) — three times all of Radix. **Nothing may
    be added on the strength of "we already have CodeMirror"**: no autocomplete, no lint, no
    search panel, no collab. Each is a separate `@codemirror/*` package precisely so it can be
    declined. If the number must come down, the lever is a lazy `import()` — the editor is one
    tab of five.
  - ⚠️ **`HighlightStyle` is defined with `class:`, not `color:`**, so Lezer's tags resolve
    through the same `--syntax-*` tokens as the response pane and `yarn contrast` audits them.
    The chrome is `EditorView.theme` with `var(--…)` values. **There is no hex literal in that
    file**, and adding a theme still needs no edit there. Painting it with a CodeMirror theme
    package would undo the entire argument for choosing CodeMirror.
  - ⚠️ **The view is built once, in a genuinely empty-dependency effect.** Everything it reads
    is behind a ref (`onChange`, the seed doc, `ariaLabel`, `placeholderText`) or a
    `Compartment` (the language). Rebuilding throws away the undo history, the caret and the
    scroll position — and `onChange` in particular *must* be a ref, since the update listener
    is baked into the initial `EditorState` and a captured callback goes stale on the parent's
    first re-render, silently writing into a dead draft.
  - ⚠️ **The value sync dispatches only when the incoming text differs from the document.**
    Every keystroke round-trips through the parent and comes back; dispatching the identical
    text would replace the whole document and collapse the selection to the end on every
    character. The check is what makes it a stable controlled component.
  - ⚠️ **`indentWithTab` is deliberately absent.** It makes Tab insert indentation, which
    turns the editor into a keyboard trap — a Tab-only user reaching the body field could
    never leave it. Format JSON already does the indentation people actually want.
  - The border and focus ring live on the **wrapper** in `BodyTab`, not in the editor:
    CodeMirror renders its own focusable `contenteditable`, so a `focus:` utility never
    matches and `focus-within` is what makes it read like the app's other inputs. The
    editor's background is `transparent` — an opaque fill would be one opaque rectangle in
    the middle of the glass theme's frosted card.
  - **`{{variables}}` are still not marked up in the body**, and CodeMirror does not change
    that: it means a `ViewPlugin` with its own decoration set plus the environment data
    `BodyTab` does not receive. A feature, not a styling detail. They still interpolate on
    send.
  - **`ScriptsTab` deliberately keeps its plain `<textarea>`.** The scripts are stored and
    never executed, so an editor there would dress up a feature that does not exist.

## Theming

**Every colour is a semantic token.** Components say `bg-surface`, `text-fg-muted`,
`border-line`, `ring-focus`, `text-method-get`, `text-syntax-key` — never `bg-white`,
`text-slate-500` or `bg-indigo-600`. All five themes are blocks of custom properties in
[index.css](frontend/src/index.css) and nothing else, which is the invariant that makes a
another theme one CSS block instead of a thirty-file audit.

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
  missing piece is a token. `ThemeMenu` groups the picker by `appearance`, so a new theme
  files itself under Light or Dark with no change there either.
- **`glass` is the one thing a colour token could not express, and it is a vocabulary, not a
  special case.** Three *effect* tokens sit beside the colours — `--canvas-image`,
  `--glass-sheen`, `--glass-backdrop` — declared `none` on `:root` so every theme inherits
  "off", and three opt-in utilities read them: `.glass` (sheen + backdrop blur),
  `.glass-tint` (sheen only) and `.glass-scrim` (blur only, for the modal overlay). A call
  site marked `glass` is therefore not glass-theme markup — it is a surface saying what kind
  of surface it is, and any later theme picks it up for free. ⚠️ The defaults are `none` and
  not a zero-strength value on purpose: `backdrop-filter: blur(0)` still promotes the element
  and still creates a containing block, so a "zero" default would charge every theme for an
  effect it does not use.
  - ⚠️ **`backdrop-filter` makes an element a containing block for `position: fixed`
    descendants**, which is the whole reason `.glass-tint` exists. The sidebar carries
    `glass-tint`, never `glass`: `NodeMenu`'s panel is `fixed` *precisely* to escape the
    sidebar's `overflow-y-auto` clip, and blurring the sidebar would re-anchor and re-clip it
    — the exact bug the fixed positioning prevents, reintroduced from a stylesheet and
    presenting as a dead ⋯ button. The panel's own `glass` is fine; an element's own filter
    does not move the element.
  - **Blur is spent only where content passes behind**: the dialog scrim and panel, the
    `Select` popper, the `NodeMenu` panel, the header and the auth card. The editor's chrome
    and its tab card sit on an opaque canvas, where a blur reveals nothing and costs a
    compositing layer, so they take the sheen alone.
  - ⚠️ **The canvas wash is load-bearing, not decoration.** Translucency over a flat colour is
    just a different flat colour and blurring one is a no-op, so `--canvas-image` is what
    makes the whole theme legible as glass. It is applied by a base rule that names `body`
    **and the `.bg-canvas` utility** — the one place in `index.css` where a token cannot
    reach on its own, because `bg-canvas` emits `background-color` only and every shell
    paints the ground itself, so a wash on `body` alone would be covered and never seen.
    `background-attachment: fixed` keeps nested canvases in register instead of each
    restarting the gradient at its own corner.
- ⚠️ **The brand is the one place a fixed hex is allowed, and only outside the app.**
  The product is **Raven**; its mark is a perched corvid drawn as a neon outline. In-app
  it is `BrandMark` in [AuthArt.tsx](frontend/src/features/auth/AuthArt.tsx) — hand-written
  paths in **`currentColor` only**, inheriting `text-accent`, used by `AuthLayout` and
  `AppHeader`. The standalone assets in `frontend/public/` (`favicon.svg`,
  `raven-mark.svg`, `raven-lockup.svg`) do carry the fixed
  `#7e14ff → #863bff → #47bfff` neon gradient, because a favicon and a lockup sit on a
  background this app does not control and there is no `var()` to read there. **Do not
  copy that gradient into a component**, and do not "fix" `BrandMark` to match the asset —
  the divergence is the rule working.
  - The glow is `.neon-mark`, a `drop-shadow` in **`currentColor`** applied only under
    `:root[data-appearance='dark']`. It introduces no token and no `PAIRS` entry on
    purpose: a drop-shadow paints outside the glyph, so it is not a foreground on a
    background and there is nothing for `check-contrast.mjs` to measure.
- **`--syntax-*` is a five-token family serving two renderers** — the response pane's
  hand-written tokenizer and CodeMirror's `HighlightStyle` — which is what keeps the two from
  drifting into different palettes six inches apart on the same screen. Its hues intentionally
  echo each theme's `--method-*` set for the same reason. It is checked against **both**
  `--canvas` (the response `<pre>` sits straight on it) and `--surface` (the editor sits in
  the request editor's card); a later XML or GraphQL mode needs no new token, only a mapping
  onto these. `--syntax-punctuation` is checked at 3.0 rather than 4.5, like `fg-faint`:
  braces and commas are structure, not prose.
- **`yarn contrast` is the guard on all of that**
  ([check-contrast.mjs](frontend/scripts/check-contrast.mjs)). It parses the CSS rather than
  importing it, composites alpha against the real surface stack — `--surface` over
  `--canvas`, every other fill over that composited surface — and exits non-zero. ⚠️ That
  stack is not a detail now that a theme makes its *surfaces* translucent and not just its
  badges: measuring a translucent white `--surface` against itself reports a near-white
  backdrop, and the audit comes back confidently wrong rather than silent. It also does not
  see `--canvas-image`, so a wash's own contribution is a hand check — the glass block
  records its measured numbers. It
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
logout-all, `GET /auth/me`, `PATCH /auth/me`, `POST /auth/change-password`, `GET /sessions` and
`DELETE /sessions/:id` all exist, and the frontend described below is wired to them.
`backend/test/auth.e2e-spec.ts` and `session-cap.e2e-spec.ts` cover the cycle end to end against
a live Postgres.

**The account screen is complete on both sides.** `/profile` edits name, email and password;
`/profile/sessions` is the old `/sessions`, moved under it, with a redirect left on the old
path. See *Profile edits* for the backend rules and *Frontend auth rules* for the client. The
two service methods are unit-tested in `auth.service.spec.ts` (the rename/email asymmetry, the
`EMAIL_TAKEN` mapping, the hash-before-revoke ordering, and the caller's own session surviving);
⚠️ **there is no e2e suite for them yet** — the paths were verified by hand against the running
stack, which is not the same thing. `register.e2e-spec.ts` is the suite to model one on, and its
`e2e-register-` email-prefix cleanup is the pattern to copy.

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

**Phases 1–3 of [TREE_SCALE_PLAN.md](TREE_SCALE_PLAN.md) have shipped** — memoized node views
over a `useSyncExternalStore` UI store, cache patching in place of tree invalidation, and a
focus/reconnect reconcile on `getTree`. It is a frontend-only change: no endpoint, contract or
DTO moved. See *Frontend workbench rules* for the resulting invariants.

**Phase 4 (lazy per-collection subtrees with hover prefetch) is deliberately not built.** The
plan gates it on workspaces actually approaching hundreds of collections, and it is the only
phase that costs a backend route, a contract change and a second data path for `MoveToDialog`;
Phases 1–3 are what make interactions instant regardless of size. The one measurement tool for
deciding is already in the repo: `node backend/scripts/seed-tree.mjs <workspaceId>` fills a
workspace with ~22k nodes and `--clean` removes them again.

**Theming is complete on the client** and there is no server side to it. Five themes (Light,
Dark, Midnight, Glass, Paper) plus System, a picker in the header and on both auth pages, and
every component converted off Tailwind's palette onto semantic tokens — the conversion was the
bulk of the work and is what keeps another theme cheap. `yarn contrast` covers all five
against WCAG AA. See *Theming* above for the traps.

**Glass** is the fifth, and the one that needed more than a block of colours: it re-uses
midnight's neutrals, cyan accent and method hues, but its surfaces are translucent white over
a washed canvas and its panels are frosted. That cost the effect-token vocabulary described
under *Theming* and a `glass`/`glass-tint` class on the app chrome and the floating
panels; it cost no new
dependency, no JavaScript and no change to `theme.ts`, `ThemeMenu` or the pre-paint script in
`index.html`.

Deliberately **not** built for theming: the preference is **per browser, not per account** —
putting it on the user row means a migration, a column, a DTO and a PATCH endpoint to make a
setting follow someone between devices, and nothing else in this slice needed the API to
change. **No user-defined colours** either: a colour picker means runtime CSS variables, a
settings surface and contrast that can no longer be guaranteed, whereas a fixed set is
auditable by `yarn contrast`. Both seams are open — a stored preference is a string this
store already knows how to apply, and a custom theme is a `data-theme` value with its
variables written onto `<html>`.

**The Send slice is complete on both sides**, and it closed the two gaps that were paired
together: the app fires requests, and the environment UI it makes meaningful shipped with
it. Backend in `backend/src/execution/` — interpolation, the SSRF address policy, the
`node:http` transport with a pinned socket and manual redirects, `POST /requests/:id/send`,
`request_executions` with two retention policies, and
`PUT /workspaces/:id/active-environment`. Frontend: `features/environments/` (picker,
manager dialog, variable grid), a Send button that sends the **draft**, a response pane
below a vertical split, and a per-request history pane. Unit specs cover interpolation,
redaction, the address table, the transport against a real loopback fixture, and the
throttler wiring; `backend/test/send.e2e-spec.ts` covers the API end to end against an
`http.createServer` fixture, so nothing in the suite touches the public internet. See
*Send* above for the traps — every one of them is load-bearing.

The one new dependency is **none**: the transport is `node:http`/`node:https`, chosen partly
because `undici`'s `Agent` (the other way to pin a connection) is not installed and Node's
global `fetch` does not expose it. **The response pane shipped as a plain `<pre>` with a
Pretty/Raw toggle, and the syntax-highlighting question `BodyTab` had deferred *to this
slice* was answered "not yet" here as well. It has since been answered properly — see
*Syntax highlighting* below, which is where the app's editor dependency arrived.**

Deliberately **not** built here, each for a stated reason: **script execution** (the slots
are stored and never run; a sandbox is the security surface and `node:vm` is not a security
boundary — its own slice, and `ScriptsTab`'s banner stays until then), a cookie jar
(per-user shared mutable state with its own tenancy question), streaming/SSE/WebSocket/
GraphQL/gRPC (every response is buffered to a cap), proxies, client certificates and any
"disable TLS verification" toggle (the last is the one most likely to be requested and the
one that turns all the SSRF work into decoration), file uploads (a storage question first),
server-side cancellation beyond the total timeout, a draggable splitter, and response
search. Still not built from earlier slices: drag-and-drop (the `/move` endpoints exist and
the kebab menu drives them; dnd is a pure-frontend change later), invites and a members pane
(no unused UI), and organizations (the seam is one nullable column).

⚠️ **The active environment is per member, not per device** — deliberately the opposite of
the theme preference, because an environment selects *which server you are about to hit* and
that should follow someone between machines. Do not "consistency-fix" either one into the
other.

Known gap, deliberate and noted in the README: **login and refresh are still unthrottled.** The
machinery is in place, so it is a `@UseGuards` on each plus a decision about shared or separate
budgets. The e2e suite also runs against the development database
rather than a scratch one; it cleans up after itself, but a dedicated test database is still the
right fix. Until then `test:e2e` runs `--runInBand`: `auth.e2e-spec.ts` and
`session-cap.e2e-spec.ts` both mutate the *same* seed user's sessions, so in parallel workers one
suite deletes rows the other is mid-assertion about. Removing that flag makes the session-cap
suite fail intermittently and for reasons that have nothing to do with the session cap.

## The rebrand

The project was `postman-clone` and is now **Raven**. The rename covered the product name,
the brand assets, `<title>`, the auth panel, `AppHeader`, the README, the root
`package.json` name, and the contracts scope — **`@postman-clone/contracts` is now
`@raven/contracts`**, in 123 files plus both lockfiles, `scripts/sync-contracts.mjs` **and
`scripts/sync-contracts.sh`** (the second is the one the root `yarn build` calls, and it is
easy to miss because nothing else reads it).

⚠️ **Three identifiers deliberately still spell the old name**, and each is a trap for a
well-meaning tidy-up:

- **`DB_NAME=postman_clone`** — renaming means creating a database and re-running every
  migration into it.
- **`JWT_ISSUER=postman-clone` / `JWT_AUDIENCE=postman-clone-api`**, their Joi defaults in
  `env.validation.ts`, and the two guard specs that hard-code them. These are *pinned into
  signed tokens*: changing them invalidates every access token in flight, so it is a
  deliberate forced logout, not a side effect of a rename. Change all five spellings
  together or the guard rejects tokens the signer just minted.
- **`pc.theme`, `pc.theme.appearance`, `pc.tree.expanded.<workspaceId>`** — renaming a
  storage key silently *discards* what it holds, so every user's theme resets to System and
  every sidebar collapses. The `pc.` prefix is invisible to users.

All three are recorded in the README under *Rebrand leftovers* as well.

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
