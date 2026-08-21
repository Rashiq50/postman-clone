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
backend    running    25636    3000   http://localhost:3000/api/v1/health   5s
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

`packages/contracts` holds the wire format: `ApiRequest`, `Workspace`, `HttpMethod`, the
pagination envelope, the API prefix and version. Both sides import it, so the shape cannot
drift silently — `RequestResponseDto implements ApiRequest` on the backend, which means **a
mismatch fails the build** rather than surfacing as a runtime bug in the browser.

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
| `GET` | `/api/v1/workspaces?page=1&limit=20` | — | `Paginated<Workspace>` |
| `POST` | `/api/v1/workspaces` | `{ name }` | `Workspace` (201) |
| `GET` | `/api/v1/workspaces/:id` | — | `Workspace` |
| `PATCH` | `/api/v1/workspaces/:id` | `{ name? }` | `Workspace` |
| `DELETE` | `/api/v1/workspaces/:id` | — | 204 (**409** if personal) |
| `PUT` | `/api/v1/workspaces/:id/active-environment` | `{ environmentId }` | `Workspace` |
| `GET` | `/api/v1/workspaces/:id/tree` | — | `WorkspaceTree` — **single resource** |
| `GET` | `/api/v1/workspaces/:id/environments` | — | `Paginated<Environment>` |
| `POST` | `/api/v1/collections` | `{ workspaceId, name, description? }` | `Collection` (201) |
| `PATCH` | `/api/v1/collections/:id` | partial | `Collection` |
| `PATCH` | `/api/v1/collections/:id/move` | `{ index }` | `Collection` |
| `DELETE` | `/api/v1/collections/:id` | — | 204 |
| `POST` | `/api/v1/folders` | `{ collectionId, parentFolderId?, name }` | `Folder` (201) |
| `PATCH` | `/api/v1/folders/:id` | `{ name? }` | `Folder` |
| `PATCH` | `/api/v1/folders/:id/move` | `{ parentFolderId, index? }` | `Folder` (**409** on a cycle) |
| `DELETE` | `/api/v1/folders/:id` | — | 204 |
| `POST` | `/api/v1/requests` | `{ collectionId, folderId?, name, … }` | `ApiRequest` (201) |
| `GET` | `/api/v1/requests/:id` | — | `ApiRequest` |
| `PATCH` | `/api/v1/requests/:id` | partial | `ApiRequest` |
| `PATCH` | `/api/v1/requests/:id/move` | `{ folderId, index? }` | `ApiRequest` |
| `DELETE` | `/api/v1/requests/:id` | — | 204 |
| `POST` | `/api/v1/environments` | `{ workspaceId, name, variables? }` | `Environment` (201) |
| `PATCH` | `/api/v1/environments/:id` | partial | `Environment` |
| `DELETE` | `/api/v1/environments/:id` | — | 204 |
| `POST` | `/api/v1/requests/:id/send` | `{ environmentId?, draft? }` | `SendResult` (**200**) |
| `GET` | `/api/v1/requests/:id/executions` | — | `Paginated<RequestExecutionSummary>` |
| `DELETE` | `/api/v1/requests/:id/executions` | — | 204 |
| `GET` | `/api/v1/executions/:id` | — | `RequestExecution` |
| `GET` | `/api/v1/health` | — | `{ status: "ok" }` |
| `GET` | `/api/v1/ready` | — | `{ status, checks }` (503 if DB down) |

Resources are **flat and top-level, with the parent id in the `POST` body** — a request's
URL therefore does not change when it moves between folders, so a bookmarked editor link
survives a reorganisation. The two nested routes (`/tree`, `/environments`) are nested
because a workspace id is not derivable from anything else.

Lists always return `{ data, meta }`. Never a bare array — growing one into a paginated
response later is a breaking change for every client. `limit` is capped at 100.

**`GET /workspaces/:id/tree` is the one deliberate exception, and it is not a list.** It
returns a single object resource, exactly as `GET /auth/me` returns one `AuthUser`, so it
has no envelope. Its inner arrays are intentionally not paginable: half a tree is not a
tree, and no page boundary makes sense across a nesting level. The escape hatch for a
very large workspace is lazy *sub*trees, not a cursor over this one. `GET /workspaces`
**is** a list and **does** return `Paginated<Workspace>`, so the rule visibly still holds.

The tree is a **skeleton**: request nodes carry `id, name, method, folderId, position` and
nothing else — no `url`, `headers`, `body` or `auth`. That is what makes fetching a whole
workspace in one call cheaper than lazy per-collection loading, which would buy no bytes
worth having and cost an N+1, a spinner per node, and more invalidation complexity. The
editor fetches the full row from `GET /requests/:id`.

**Health probes** use a simple JSON shape (not the API error envelope):

| Endpoint | Purpose | Success | Failure |
| --- | --- | --- | --- |
| `GET /api/v1/health` | Liveness — process is up | `200 { "status": "ok" }` | — |
| `GET /api/v1/ready` | Readiness — can serve traffic (DB reachable) | `200 { "status": "ok", "checks": { "database": "up" } }` | `503 { "status": "error", "checks": { "database": "down" } }` |

Wire Kubernetes (or similar) liveness to `/health` and readiness to `/ready`.

**Controllers never return entities.** They return a DTO such as `RequestResponseDto`,
built with class-transformer's `excludeExtraneousValues`, so only `@Expose()`d fields
reach the wire. A column added to the entity tomorrow — a password hash, an internal flag,
a soft-delete timestamp — is dropped by default instead of leaking. Keep it that way.

Request bodies go through a global `ValidationPipe` with `whitelist` and
`forbidNonWhitelisted`, so unknown fields are rejected with a 400 rather than silently
assigned.

### Domain and tenancy

The model is `User → Workspace → { Collection → Folder → Request, Environment }`, with
membership in `workspace_members`. Organizations are **deliberately deferred** behind a
nullable `workspaces."organizationId"` seam: the column exists and is always NULL, so
attaching them later is one `ALTER TABLE … ADD CONSTRAINT … NOT VALID` rather than a
column addition, a backfill, and a rewrite of every scoping clause. Workspaces were built
first for exactly that reason — retrofitting `workspaceId` onto a populated
`collections`/`requests` set would have been the expensive direction.

**Authorization travels inside the statement that reads or writes. There is no
authorization guard, and adding one would be a regression.** Instead of a single-owner
`WHERE "ownerId" = :ownerId` it is
`WHERE "collectionId" IN (<collections I can write to>)`. See
`backend/src/workspaces/workspace-scope.ts` for the fragments and the four concrete
failure modes a guard has — the sharpest being that on `POST /requests` the parent id is
in the **body**, where a route-param guard cannot see it at all, so such a guard passes
every hand test while leaving a full cross-tenant write unauthorized.

- **Not a member → 404**: a 403 confirms the id is real and enables enumeration.
  **A member whose role is too low → 403**, which leaks nothing because they can already
  read the row.
- Roles are `OWNER`/`ADMIN`/`EDITOR`/`VIEWER`, stored as `varchar` + a `CHECK` rather than
  a Postgres enum, because role sets churn and a `CHECK` is one statement to change. Role
  checks live nowhere but the `roles` array bound into the scope fragment.
- **There is no invite endpoint and no members UI in this slice**, so every membership is
  the `OWNER` row of someone's own personal workspace. `VIEWER` is built anyway because
  threading the `roles` array through every query is the expensive part and is much worse
  to retrofit; `workspaces.e2e-spec.ts` inserts a `VIEWER` row directly to prove it works.
- Ordering is `position integer` with gaps of 1024, reindexed on demand, and every query
  sorts by `position, createdAt, id` — the trailing keys make a shared position a cosmetic
  problem rather than an order that flickers between refetches.
- A **personal workspace is provisioned inside the user-creation transaction**
  (`UsersService.create`), not by the caller afterwards. A user row with no workspace is a
  silently and permanently broken account: registration still returns 201 with a working
  token, `GET /workspaces` is empty, and no endpoint repairs it.

⚠️ **Secrets are stored and returned in plaintext.** `environments.variables`,
`requests.auth` and **`request_executions`** hold bearer tokens, passwords and API keys
unencrypted, and `GET /requests/:id` hands them straight back; the `type="password"`
inputs in the editor and the environment grid are cosmetic. `request_executions` is the
third such store and the least obvious: it keeps response bodies (which echo back whatever
the target reflects) plus the request URL and every redirect hop, redacted only for values
an environment marked `secret`. Sent request *headers* are deliberately not stored at all,
which is what keeps the freshly built `Authorization` header out of that table; the
per-request row cap limits the blast radius without removing it. This is what Postman does and an accepted trade-off for this slice, but it
is a real gap, not an oversight — the fix is a separate write-only secrets table with
envelope encryption, and it should land before this is exposed to anyone but its author.

**Sending is built.** `POST /requests/:id/send` interpolates `{{var}}` from the caller's
active environment, screens every resolved address against an SSRF policy, pins the socket
to a screened address, follows redirects manually (re-screening each hop and stripping
credentials across origins), caps response size and total time, and records the run in
`request_executions`. The environment UI landed with it, which is what makes an environment
editor worth having: it now has an observable effect.

⚠️ **The one rule to know: a failed upstream request is not an API error of ours.**
`/send` answers **200** whether the target returned 200, returned 500, refused the
connection, or was blocked before a socket opened. The outcome is a union inside the body,
discriminated on `outcome` (`'response' | 'failure'`). The error envelope below is reserved
strictly for *our* failures — a malformed DTO, a request you may not see, a rate limit.
Collapsing upstream failures into it would make a 500 from the target indistinguishable
from this API falling over, and would mean the response pane could never show a 4xx body,
which is most of what a person presses Send to look at.

Still deliberately **not** built: script execution (the two slots are stored and never run
— a sandbox is the security surface, and `node:vm` is not a security boundary), a cookie
jar, streaming, proxies, client certificates, and any "disable TLS verification" toggle —
the last being the one most likely to be asked for and the one that would turn all the SSRF
work into decoration.

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
    "path": "/api/v1/requests"
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
no script on the page can read it and it is never attached to the resource routes.

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

**Rate limiting.** `POST /auth/register` is throttled per caller IP by `ApiThrottlerGuard`, a
`ThrottlerGuard` subclass that renders its refusal in this API's envelope — `429` with the
`RATE_LIMITED` code, which until now existed in `ApiErrorCode` with nothing producing it — and
normalises `Retry-After` (the base guard suffixes that header with the throttler's name for
every window but `default`, producing a `Retry-After-burst` no client looks for).

Two windows apply to the same request, configured by `THROTTLE_BURST_*` and
`THROTTLE_SUSTAINED_*`: 5 per minute bounds a spike, 20 per hour bounds the total. One window
alone forces a bad trade — short and generous leaves an attacker running at that rate forever,
long and tight locks out an office behind one NAT. Rejected bodies count too, which is the point:
an address-enumeration run never sends a body that succeeds.

The guard is applied with `@UseGuards` on the one route that needs it, never as an `APP_GUARD` —
a global throttler would put every API endpoint on a shared IP budget. It also runs *before*
`OriginCheckGuard`, so a flood is bounded whatever it claims to be, and it is the only thing
between an unauthenticated caller and an unbounded number of deliberately-expensive Argon2 hashes.

**Two limitations, both real.** The counters are in-memory and per process, so N instances behind
a load balancer allow N× the configured rate — `@nestjs/throttler-storage-redis` is the fix.
And `req.ip` is the *proxy's* address behind a load balancer, because `main.ts` does not enable
Express's `trust proxy`; until that changes, every caller shares one bucket in such a deployment,
which is a denial of service against your own signups rather than a defence. Enabling trust proxy
with the deployment's real hop count is a prerequisite for relying on this in production.

**Known gap:** login and refresh are still unthrottled. Both are brute-forceable and the session
cap bounds stored rows, not attempts. The machinery is now in place — `ThrottlerModule` is
configured in `AuthModule` and the guard is a shared provider — so closing it is a
`@UseGuards(ApiThrottlerGuard)` on each, plus a decision about whether they should share
register's budget or get their own named windows.

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
both `features/auth` and `features/requests` depend on it. Use plain slices in
`src/app/store.ts` for local UI state.

Routing is `react-router` v7, used as a router only — no `loader`/`action`/`fetcher`, since
loaders would need the access token out of Redux. A production deploy needs an SPA fallback
(every path serves `index.html`); `vite dev` and `vite preview` already do this.

There are **two shells**, not one with a branch. `AppShell` is the original `min-h-screen`
centred `max-w-3xl` column; `WorkbenchShell` is the opposite layout contract — `h-screen
overflow-hidden`, a fixed sidebar, panes that scroll independently. `/` redirects to
`/w/:workspaceId`, and the request editor is `/w/:workspaceId/requests/:requestId`.

**The workspace id lives in the URL, and that is a correctness requirement rather than a
preference.** This app persists no application state — no `localStorage`, no
`sessionStorage`, no `redux-persist` — so an id kept in Redux would not survive a reload:
every refresh would silently drop the user into "the first workspace", which stays
invisible until someone has two. The URL is the only persistence layer available here, and
it gives deep links, a working Back button and two tabs on two workspaces for free. (The
lone thing this app does put in storage is the theme preference, which is a display setting
rather than application state — see *Theming* below.)

`/sessions` keeps the centred shell; everything else lives in the workbench.

### Theming

Five themes ship — **Light**, **Dark**, **Midnight** (true black, cyan accent), **Glass**
(midnight's palette behind frosted panels) and **Paper** (warm off-white, amber accent) —
plus **System**, which follows `prefers-color-scheme` and keeps following it when the OS
changes mid-session. The picker is in the header, and also on
`/login` and `/register`: a preference you cannot reach until after you have signed in is
not really a preference.

**Every colour in the app is a semantic token.** Components say `bg-surface`,
`text-fg-subtle`, `border-line`, `text-method-get` — never `bg-white` or `text-slate-500`.
A theme is then one block of custom properties in `frontend/src/index.css` and nothing else,
which is the whole point: adding a theme must not mean auditing thirty components.
The `@theme inline` block that maps `--color-surface` to `--surface` is load-bearing —
without `inline` Tailwind bakes the value in at build time and switching themes does nothing.

Tailwind's default palette is still generated. Removing it would turn a stray `bg-slate-50`
into a class that silently renders nothing, which is worse than one that renders wrong, so
the rule is a convention rather than a compile error: **if a token is missing, add a token.**
A palette utility that slips in pins that one element to light mode forever, and nobody
notices until they switch themes.

**Glass is the one theme that needed more than colours**, and it is worth knowing why. A
blur is not a colour, so no `bg-*` utility can carry one: a surface can say what it is
*coloured* but not what it is *made of*. Three *effect* tokens sit beside the colour tokens
for that — `--canvas-image`, `--glass-sheen`, `--glass-backdrop` — declared `none` on
`:root`, so every other theme inherits "off", and three opt-in classes read them: `glass`
(sheen and backdrop blur), `glass-tint` (sheen only) and `glass-scrim` (blur only, for the
modal overlay). A surface marked `glass` is not glass-theme markup; it is a surface saying
what kind of surface it is, which any later theme can pick up for free.

Three things about it are easy to get wrong. Blur only earns its compositing layer where
content actually passes behind — the modal scrim, the dropdowns, the kebab menu — so chrome
that sits on an opaque canvas takes the sheen alone. `backdrop-filter` makes an element a
containing block for `position: fixed` descendants, which is why the sidebar takes
`glass-tint` and never `glass`: its kebab menu is `fixed` precisely to escape the sidebar's
scroll clip, and blurring the sidebar would clip it again. And the canvas wash
(`--canvas-image`) is load-bearing rather than decorative — translucency over a flat colour
is just a different flat colour, and blurring a flat colour is a no-op, so removing the wash
would switch the theme off while leaving every effect running.

`yarn contrast` audits all five themes against WCAG AA — every foreground/background pair
the components actually put together, with alpha composited against the real surface stack
(`--surface` over `--canvas`, every other fill over that). The stack matters once a theme
makes its surfaces translucent and not merely its badges: measured against itself, a
translucent white surface reports a near-white backdrop and the audit comes back confidently
wrong rather than silent. It does not see `--canvas-image`, so a wash is a hand check; the
glass block in `index.css` records its measured numbers.
It found four real failures on the first run, including white-on-indigo-400 at 2.98:1 in the
dark theme's primary button, which is why `--on-accent` flips dark there. **Add the pair to
`frontend/scripts/check-contrast.mjs` when you add a token combination** — an unlisted pair
is unchecked, not passing.

Two mechanics are easy to break:

- **The theme is applied before React mounts,** by an inline classic script in `index.html`.
  A module script is deferred and a `useEffect` runs after the first paint, so either one
  flashes the light theme on every reload — the most visible dark-mode bug there is, and one
  that cannot be fixed from inside React. That script mirrors two storage keys and two
  attribute names from `features/theme/theme.ts`; they change together.
- **The preference lives in `localStorage`, deliberately, and outside Redux.** The store has
  to exist before React does, so a Redux copy would be a second source of truth for one DOM
  attribute. This is not a hole in the no-persistence rule above: that rule is about
  credentials and server state, and a colour preference that resets on every reload is a bug
  rather than a safeguard.

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
- **Organizations** — the seam is `workspaces."organizationId"`: nullable, always NULL,
  no FK. Adding them is a table, a membership table, and one `NOT VALID` foreign key; no
  read path or route changes, because every query reaches a workspace through
  `workspace_members` and routes are `/workspaces/:id/…` rather than
  `/orgs/:orgId/workspaces/:id`. The one genuinely open question it defers is whether an
  org ADMIN implicitly gets EDITOR on every workspace in the org — and that lives in one
  function.
- **Sharing** — needs an invite endpoint, a members pane, and one paired schema change:
  `workspaces.ownerUserId` is `ON DELETE CASCADE` today, which is right while every
  workspace is personal and wrong the moment one is not, since deleting a user would take
  a team's collections with it. It must become `RESTRICT` plus an ownership-transfer
  endpoint — and `workspaces.e2e-spec.ts` cleans up by deleting users, so its teardown
  changes at the same time.
- **Script execution** — the pre-request and post-response slots are stored and never run.
  The banner in `ScriptsTab` says so and stays until they do. A sandbox is the whole cost
  here; `node:vm` is not a security boundary.
- **Login and refresh throttling** — the machinery exists (`ThrottlingModule`, four named
  windows, per-name `@SkipThrottle`), so it is a `@UseGuards` on each plus a decision about
  shared or separate budgets.
- **Encrypting stored secrets** — see the plaintext note under *Domain and tenancy*.
- Not yet present and not path-dependent: Docker Compose, e2e test database.
