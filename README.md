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
| `GET` | `/api/v1/tasks?page=1&limit=20` | — | `Paginated<Task>` |
| `POST` | `/api/v1/tasks` | `{ title, description?, status? }` | `Task` (201) |
| `GET` | `/api/v1/tasks/:id` | — | `Task` |
| `PATCH` | `/api/v1/tasks/:id` | partial | `Task` |
| `DELETE` | `/api/v1/tasks/:id` | — | 204 |

Lists always return `{ data, meta }`. Never a bare array — growing one into a paginated
response later is a breaking change for every client. `limit` is capped at 100.

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
`src/features/tasks/tasksApi.ts` — and features add endpoints with `injectEndpoints`
rather than calling `createApi` again. One cache, one middleware, and one place to put auth
headers and 401-refresh when those land. Use plain slices in `src/app/store.ts` for local
UI state.

## Notes for what's coming

- **WebSockets** — keep app servers stateless (no in-memory socket or session maps) so a
  second instance can be added with a Redis adapter rather than a rewrite.
- **Payments** — Stripe webhook signature verification needs the raw request body, which
  Nest's JSON parser consumes. Create the app with `NestFactory.create(AppModule,
  { rawBody: true })` before integrating. Plan idempotency keys on money-moving endpoints.
- **RBAC** — `Task` has no owner column yet. Adding audit/ownership columns to a base
  entity before the table grows avoids a backfill later.
- Not yet present and not path-dependent: structured error codes, correlation IDs, health
  checks, Docker Compose, e2e test database.
