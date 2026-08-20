# Request execution engine ("Send")

## Context

The app stores requests but cannot fire them. `RequestEditor` is a complete
Postman/Bruno-style editor — method, URL, params, headers, body, auth, scripts — and every
one of those fields round-trips to Postgres and is never used. `RequestUrlBar.tsx` carries a
standing comment saying there is deliberately no Send button, and the README lists Send as
the next slice with its budget stated: *"SSRF, redirect handling, timeouts and response size
caps"*. The `environments` table, contracts and CRUD already exist with **no frontend at
all**, for the reason the README gives: *"an environment editor without interpolation is a
form with no observable effect."*

This slice closes both gaps at once. After it, a user picks an environment, presses Send,
and sees a real response — and the environment UI finally has an observable effect.

Scope decisions taken up front:

| Decision | Choice |
|---|---|
| `{{var}}` interpolation | **In.** Full environment UI + active-environment persistence. |
| Script execution | **Out.** `RequestScripts` stays stored-only; `ScriptsTab`'s banner stays. |
| SSRF | **Env-gated.** Resolve → check every IP → pin the socket. Blocking on by default, `SEND_ALLOW_PRIVATE_NETWORK=true` disables it for local dev. |
| History | **In.** `request_executions` table + a history pane + pruning. |

---

## The one idea that shapes everything

**A failed upstream request is not an API error of ours.** `POST /requests/:id/send`
answers **200** whether the target returned 200, 500, or refused the connection. The
`SendResult` is a discriminated union on `outcome`:

```ts
type SendResult =
  | { outcome: 'response'; execution: RequestExecution }   // we spoke to the target
  | { outcome: 'error';    execution: RequestExecution }   // we could not
```

Our error envelope (`{ error: { code, ... } }`) is reserved for *our* failures: not
authenticated, not your request, malformed DTO, rate limited, blocked by the SSRF policy
before any socket opened. Everything downstream of "we opened a socket" is a successful
API call describing an unsuccessful HTTP call.

Getting this wrong is the trap the README already flags — `toApiError()` returns `null`
when the failure never reached our API, precisely so a proxy error is not reported as if
the API had spoken. Collapsing upstream failures into `ApiException` would make a 500 from
`httpbin.org` indistinguishable from our own backend crashing, and the response pane could
never show a 4xx body — which is most of what a person presses Send to look at.

---

## Phase 1 — Contracts

**Create `packages/contracts/src/execution.ts`:**

```ts
export const SEND_FAILURE_REASONS = [
  'dns', 'connect', 'tls', 'timeout', 'too-many-redirects',
  'blocked', 'response-too-large', 'unknown',
] as const
export type SendFailureReason = (typeof SEND_FAILURE_REASONS)[number]

export const RESPONSE_BODY_ENCODINGS = ['utf8', 'base64'] as const

export interface ExecutionTimings {
  /** ms from the send call to the first response byte. */
  waitMs: number
  /** ms end to end, including the body download. */
  totalMs: number
}

export interface SentRequestSummary {
  method: HttpMethod
  /** Post-interpolation, post-redirect. What actually went out. */
  url: string
  headers: KeyValueEntry[]
}

export interface ResponseSummary {
  status: number
  statusText: string
  headers: KeyValueEntry[]
  bodyEncoding: (typeof RESPONSE_BODY_ENCODINGS)[number]
  body: string
  /** Bytes received. May exceed `body.length` when truncated. */
  sizeBytes: number
  truncated: boolean
}

export interface RequestExecution {
  id: string
  requestId: string
  environmentId: string | null
  sent: SentRequestSummary
  response: ResponseSummary | null
  failure: { reason: SendFailureReason; message: string } | null
  timings: ExecutionTimings
  /** Non-fatal notes — chiefly unresolved `{{var}}` names. */
  warnings: string[]
  createdAt: string
}

export type SendResult =
  | { outcome: 'response'; execution: RequestExecution }
  | { outcome: 'error'; execution: RequestExecution }

export interface SendRequestInput {
  environmentId?: string | null
  /** Unsaved editor state. Omit to send exactly what is stored. */
  overrides?: UpdateApiRequestInput
}
```

**Amend `packages/contracts/src/workspace.ts`:** add `activeEnvironmentId: string | null`
to the `Workspace` read model, plus `SetActiveEnvironmentInput { environmentId: string | null }`.
It rides beside `role` — which is already *"not a property of the workspace but the answer
to 'what may you do here'"*, joined in from `workspace_members`. `activeEnvironmentId` is
the same kind of field, so it costs one entry in `WORKSPACE_SELECT`
([workspaces.service.ts](backend/src/workspaces/workspaces.service.ts)) and one `@Expose()`
on `WorkspaceResponseDto`, and nothing else.

**Barrel:** add `export * from './execution'` to `index.ts`.

⚠️ No TS `enum` anywhere — `as const` objects only, because the frontend compiles with
`erasableSyntaxOnly`. ⚠️ After editing, **run `./dev.sh contracts`** or both sides keep
compiling against the stale copy.

### Why `overrides` exists

The editor has no autosave. Without `overrides`, Send would fire the *last saved* request
while the user looks at their edits — the single most confusing possible behaviour. The
alternative (force a save on Send) silently writes to disk on what the user reads as a
read-only action. So the client posts its dirty draft and the server merges
`{ ...stored, ...overrides }` before interpolating. The stored row is the authorization
anchor; `overrides` never carries `collectionId` or `folderId` (it is `UpdateApiRequestInput`,
which omits both by construction) so it cannot reparent anything.

---

## Phase 2 — The interpolation engine (pure, unit-tested)

**Create `backend/src/execution/interpolate.ts`** — no Nest decorators, no DB, no I/O. A
pure module in the spirit of `workspace-scope.ts` and `sibling-positions.ts`.

```ts
export interface InterpolationResult<T> { value: T; unresolved: string[] }
export function buildScope(env: Environment | null): Map<string, string>
export function interpolate(text: string, scope: Map<string, string>): InterpolationResult<string>
export function interpolateRequest(draft: RequestDraft, scope: Map<string, string>): InterpolationResult<RequestDraft>
```

Rules, each of which is a decision a future reader would otherwise re-litigate:

- **Syntax is `{{name}}`.** `name` is `[A-Za-z0-9_.-]+`; whitespace inside the braces is
  trimmed (`{{ baseUrl }}` works, because people type it).
- **Escape is `\{{`**, which emits a literal `{{`. Needed because JSON bodies and template
  syntaxes legitimately contain double braces.
- **Scope is one flat `Map`**, built from the active environment's `variables` filtered to
  `enabled === true`. Later entries win over earlier ones, so a duplicate key in the editor
  behaves like the last row you typed. There is exactly **one** source in this slice —
  collection-level and global variables are a later layer, and the `Map` is the seam that
  makes them a merge rather than a rewrite.
- ⚠️ **Substitution is single-pass and non-recursive.** `{{a}}` resolving to `{{b}}` yields
  the literal `{{b}}`. Recursion needs a cycle detector and buys almost nothing; the
  single-pass rule is the thing to state loudly rather than the behaviour to "fix".
- ⚠️ **An unresolved variable is left verbatim and recorded as a warning**, never
  substituted with the empty string and never a hard failure. Empty-string substitution
  turns `{{baseUrl}}/users` into `/users` — a request against a *different host* that may
  well succeed, which is the worst of the three outcomes. Leaving it literal makes the URL
  fail to parse and the failure names the variable. The warnings ride on the execution
  record so the response pane can say *"`baseUrl` is not defined in this environment."*
- **Applied to:** URL, every enabled query param key and value, every enabled header key and
  value, the body (`raw`/`json` text, and `form-urlencoded` entries), and every string field
  of `auth`. Disabled rows are dropped before interpolation, not after — a disabled row's
  `{{secret}}` must never appear in a warning list.
- ⚠️ **`auth.type === 'inherit'` behaves exactly as `none`** in this slice, with a warning
  attached. There is no collection-level auth to inherit *from* yet; silently sending
  unauthenticated with no signal is the failure mode. This is the default for every newly
  created request, so the warning must be worded as information, not alarm.

**`backend/src/execution/interpolate.spec.ts`** covers: plain substitution, the escape,
whitespace tolerance, unresolved reporting, non-recursion, disabled-row exclusion, and
substitution inside each body mode and auth variant.

---

## Phase 3 — The HTTP client layer

**Create `backend/src/execution/http-client.ts`** and **`backend/src/execution/ssrf.ts`**.

### Dependency

Add **`undici`** to `backend/package.json`. Node 24 ships undici *inside* `fetch`, but the
`Agent`/`Client` classes are not exposed on any `node:` builtin, and there is no other way
to get a custom `lookup` onto the socket. The alternative — `node:https` by hand — means
writing redirect following, header casing and body streaming from scratch, which is
strictly more code and more bugs than one dependency. **This is the only new backend
dependency in the slice.**

### The SSRF check, and why it is shaped this way

```ts
// ssrf.ts
export function isBlockedAddress(ip: string): boolean
export async function resolveAndCheck(hostname: string, allowPrivate: boolean): Promise<string[]>
```

- **Resolve first, check every returned address, then pin.** `dns.lookup(host, { all: true })`
  → reject if *any* resolved address is blocked → hand undici a `lookup` that returns only
  the already-approved addresses. ⚠️ Checking the hostname and then letting the socket
  re-resolve is a **DNS-rebinding hole**: an attacker's resolver answers `1.2.3.4` for the
  check and `127.0.0.1` for the connection. The pin is the entire point of doing this by
  hand rather than with plain `fetch`.
- **Blocked ranges:** loopback (`127.0.0.0/8`, `::1`), private (`10/8`, `172.16/12`,
  `192.168/16`), link-local (`169.254/16` — which covers the `169.254.169.254` cloud
  metadata endpoint), CGNAT (`100.64/10`), unique-local (`fc00::/7`), unspecified
  (`0.0.0.0`, `::`), and IPv4-mapped IPv6 (`::ffff:127.0.0.1`) — ⚠️ the mapped form is the
  one people forget, and it is trivially reachable.
- **Non-HTTP schemes are rejected before DNS.** Only `http:` and `https:` — `file:`,
  `ftp:`, `gopher:` are refused outright.
- **`SEND_ALLOW_PRIVATE_NETWORK`** (boolean, default `false`) disables the address check
  *only*. The scheme check and the caps below are never bypassable. Must be added to
  `backend/src/config/env.validation.ts` — Joi runs with `whitelist`, so a var missing from
  the schema is invisible to `ConfigService` no matter what `.env` says.

A blocked URL is one of the **few** upstream-ish failures that is genuinely ours, because
nothing was sent: return `outcome: 'error'` with `reason: 'blocked'` (not an `ApiException`),
so it lands in the response pane and in history like every other failure. Consistency in the
pane beats taxonomic purity here.

### The client

- **Redirects are followed manually**, `redirect: 'manual'`, capped at `SEND_MAX_REDIRECTS`
  (default 5). ⚠️ **Every hop re-runs the full SSRF check** — a public URL that 302s to
  `http://169.254.169.254/` is the textbook bypass, and undici's automatic redirect
  following would take that hop with the check already behind it. On 301/302/303 the method
  becomes `GET` and the body is dropped; on 307/308 both are preserved. ⚠️ **`Authorization`
  and `Cookie` are stripped on a cross-origin hop** — following a redirect to an attacker's
  host with the user's bearer token attached is a credential leak, and it is the default
  behaviour of naive implementations.
- **Two timeouts, from env:** `SEND_CONNECT_TIMEOUT_MS` (default 10 000) and
  `SEND_TOTAL_TIMEOUT_MS` (default 30 000, an `AbortSignal.timeout` spanning the whole
  operation including redirects and body download). One timeout cannot be both.
- **Response size cap** `SEND_MAX_RESPONSE_BYTES` (default 5 MiB). ⚠️ The body is read as a
  **stream and counted as it arrives**, aborting at the cap. Trusting `Content-Length` is
  not a cap — it is absent on chunked responses and can simply lie. Overflow is **not** an
  error: the record carries `truncated: true` and what arrived, because a truncated 200 is
  still useful and a hard failure on a large response is infuriating.
- **Binary handling:** decode as UTF-8 when the `Content-Type` is textual (`text/*`,
  `application/json`, `+json`, `application/xml`, `+xml`, `application/javascript`,
  `x-www-form-urlencoded`) **or** when there is no `Content-Type` and the bytes are valid
  UTF-8; otherwise base64 with `bodyEncoding: 'base64'`. ⚠️ jsonb columns cannot hold a
  ` ` byte — Postgres rejects it — so a lone invalid-UTF-8 path is not merely ugly, it
  is a 500 on the history insert.
- **Body assembly:** `json` mode sends the raw text with `Content-Type: application/json`
  **without re-serialising it** (the user's formatting and their deliberate malformed JSON
  are both the point of a testing tool); `form-urlencoded` builds a `URLSearchParams` from
  enabled entries; `raw` sends the text as `text/plain`. In every case a user-supplied
  `Content-Type` header **wins** over the mode's default.
- **Auth application:** `bearer` → `Authorization: Bearer <token>`; `basic` →
  `Authorization: Basic base64(user:pass)`; `apiKey` → a header or a query param per
  `auth.in`; `none`/`inherit` → nothing. Applied *after* header interpolation, and an
  explicit `Authorization` row in the headers editor wins — the visible thing beats the
  configured thing.
- **Timings** are `performance.now()` deltas: `waitMs` to response headers, `totalMs` to the
  last body byte.
- ⚠️ **Compression:** send `Accept-Encoding: identity` unless the user set the header. undici
  decompresses transparently, which would make `sizeBytes` and the size cap describe
  post-decompression bytes and open a zip-bomb path around the cap.

**`ssrf.spec.ts`** unit-tests the range classifier exhaustively (it is a pure function, and
it is the security boundary). The client itself is exercised in e2e against a throwaway
`http.createServer` — not against the public internet.

---

## Phase 4 — The endpoint, the entity and history

### `POST /requests/:id/send`

**Create `backend/src/execution/`**: `execution.module.ts`, `execution.controller.ts`,
`execution.service.ts`, `dto/send-request.dto.ts`, `dto/request-execution.dto.ts`,
`entities/request-execution.entity.ts`, plus the two pure modules above.

Flow:

1. `requestsService.findOne(userId, id)` — reuse it exactly. Authorization stays folded into
   SQL under `REQUEST_SCOPE`/`WRITE_ROLES`; **no guard is added**, per `workspace-scope.ts`.
2. If `environmentId` is given, load it under `ENVIRONMENT_SCOPE` + `READ_ROLES` and — ⚠️ —
   **verify it belongs to the same workspace as the request's collection**. Both being
   visible to the caller is not enough; without this a user can read environment A into a
   request in workspace B, which is a cross-workspace read they did not ask for and would
   not expect.
3. Merge `overrides`, interpolate, build, send.
4. Insert the `request_executions` row.
5. Return `SendResult` via `RequestExecutionResponseDto` — `@Expose()`-only,
   `excludeExtraneousValues`, with `implements RequestExecution`. **Never return the entity.**

⚠️ **Throttled with its own budget**, not register's:
`@UseGuards(SendThrottlerGuard)` with `SEND_THROTTLE_*` env vars (suggested: 30/min burst,
600/hour sustained). Sharing register's 5-per-minute window would make the app unusable;
leaving it unthrottled makes an authenticated account a free scanning proxy. Note the two
documented caveats that still apply: in-memory storage is per-process, and `req.ip` is the
proxy's address because `trust proxy` is off. Tests override the `THROTTLER_OPTIONS` token,
**never `process.env`** — `ConfigModule.forRoot()` reads the environment at *import* time.

### `request_executions`

`GET /requests/:id/executions` (paginated, newest first) and
`DELETE /requests/:id/executions` (clear history for one request).

Entity — real columns `id`, `requestId` (FK → `requests`, **`ON DELETE CASCADE`**: an
execution has no meaning without its request), `environmentId` (FK → `environments`,
**`ON DELETE SET NULL`**, nullable: deleting an environment must not erase history),
`method varchar(10)`, `url text`, `status integer null`, `waitMs`/`totalMs integer`,
`sizeBytes integer`, `truncated boolean`, `failureReason varchar(32) null`,
`failureMessage text null`, `createdAt timestamptz`. jsonb columns `sentHeaders`,
`responseHeaders`, `warnings` (default `'[]'`), `responseBody text null` +
`bodyEncoding varchar(8) null`.

⚠️ **The schema traps from `CLAUDE.md` apply in full**: jsonb defaults are SQL expressions
with **no `::jsonb` cast**, spelled the way Postgres normalizes them (`'[]'`); `method` and
`failureReason` are `varchar` + `@Check`, never `type: 'enum'`. Index on
`(requestId, createdAt DESC)` — the only query shape. **New migration** in
`backend/src/database/migrations/` (hand-written; `migration:generate` will also propose
replacing `FK_folders_parent` and `FK_requests_folder` with single-column FKs — ⚠️ **that
diff is expected and must be discarded**).

**Pruning, in the insert's transaction**, the same shape as `MAX_SESSIONS_PER_USER`: one
set-based `DELETE` keeping the newest `SEND_HISTORY_PER_REQUEST` (default 50) rows for that
request. Bounded at write time, so there is no cron, no `@nestjs/schedule` (not a
dependency, deliberately) and no unbounded table.

⚠️ **History stores request and response bodies and headers in plaintext, including the
`Authorization` header the engine just built.** This is a *new* place secrets land, beyond
the two the README already documents. It must be added to that README warning in the same
change — the row cap limits the blast radius, it does not remove it.

### Active environment

**Migration:** add `workspace_members.activeEnvironmentId uuid NULL`, FK → `environments`
**`ON DELETE SET NULL`** (deleting the selected environment must deselect it, not orphan a
dangling id). No `NOT NULL`, no default: "no environment" is a real and normal state.

**`PATCH /workspaces/:id/active-environment`** on `WorkspacesController`, body
`{ environmentId: string | null }`, scoped under `READ_ROLES` — ⚠️ **a `VIEWER` may pick
their own environment.** It is that member's own row and changes nothing anyone else sees;
gating it behind `WRITE_ROLES` would leave viewers unable to send anything against a real
base URL. Setting it validates the environment belongs to that workspace. It is returned on
`WorkspaceResponseDto` as the caller's own value.

---

## Phase 5 — Frontend

### `frontend/src/features/environments/` (new)

- `environmentsApi.ts` — `getEnvironments`, `createEnvironment`, `updateEnvironment`,
  `deleteEnvironment` via `baseApi.injectEndpoints`. Add **`Environment`** to `tagTypes` in
  `frontend/src/app/baseApi.ts` — this is the feature that reads it, which is exactly the
  stated rule for when a tag is allowed to appear.
- `EnvironmentPicker.tsx` — a `components/ui/Select` in `AppHeader` beside
  `WorkspaceSwitcher`, with a "No environment" entry and a "Manage…" entry that opens the
  editor. ⚠️ Pass **`undefined`, never `''`** for "nothing selected" — Radix reserves the
  empty string and an unmatched value renders a blank trigger with no placeholder.
- `EnvironmentsDialog.tsx` — a `components/ui/Dialog` listing environments with a
  `KeyValueEditor`-shaped variables table. **Reuse `KeyValueEditor.tsx`** rather than
  writing a second one; it already handles the blank trailing row and the enabled checkbox.
  The `secret` flag renders the value as `type="password"` — cosmetic, same as `AuthTab`.

### The response pane

`RequestEditor.tsx` becomes a vertical split: the existing tabbed request editor on top, a
response pane below, with a draggable divider.

⚠️ **The `min-h-0` chain is load-bearing all the way down.** `WorkbenchShell`'s grid and
`<main>` already carry it; every new flex child on the path to the response pane's scroll
container needs it too, or the pane sizes to its content and the whole page scrolls instead
— the exact failure `CLAUDE.md` documents for the workbench grid.

- `SendButton` in `RequestUrlBar.tsx`, next to Save. ⚠️ **Delete the "there is no Send
  button" comment in the same change** — it is a standing instruction to future readers and
  leaving it makes the file lie. Same for `ScriptsTab`'s banner: scripts are *still* not
  executed, so that banner **stays**, but its wording ("sending requests is not built")
  becomes false and must be corrected to say scripts specifically.
- `ResponsePane.tsx` — a status line (status pill, `statusText`, `totalMs`, formatted
  `sizeBytes`), then Radix tabs: **Body** (pretty-printed when JSON, raw otherwise, with the
  same Format-style plain `<textarea>`/`<pre>` — **no editor library**, which is the
  dependency decision `BodyTab.tsx` explicitly deferred *to this slice*: the answer is still
  no, because a `<pre>` with `white-space: pre-wrap` renders JSON perfectly well and syntax
  highlighting is a want), **Headers** (a read-only table), and **History**.
- Empty state before the first send; a skeleton while in flight; a `warnings` strip
  (`bg-warning-soft`) above the body when the execution carries any.
- Base64 bodies show a "binary response, N bytes" placeholder with a copy button, never the
  base64 blob rendered as text.
- The response lives in **component state**, not Redux — the store holds only `api` and
  `auth`, and nothing is persisted in Redux at all. `sendRequest` is an RTK Query
  **mutation** (it has side effects and writes history), so its result is available from the
  hook without any new slice.

### Tokens

⚠️ Status pills need a colour per class and there is currently **no `info` family and no
solid `--success`**. Add **`--info-soft` / `--info-soft-fg`** to **all five** theme blocks in
`frontend/src/index.css`, mirror them in the `@theme inline` block, and add
`['info-soft-fg on info-soft', '--info-soft-fg', '--info-soft', 4.5]` to `PAIRS` in
`frontend/scripts/check-contrast.mjs`. ⚠️ **A token pair not in `PAIRS` is unchecked, not
passing.** Mapping: 2xx → `success-soft`, 3xx → `info-soft`, 4xx → `warning-soft`, 5xx and
every `outcome: 'error'` → `danger-soft`. Every colour is a semantic token — **never** a
Tailwind palette utility, which would pin the pill to light mode forever.

---

## New environment variables

All of these go into **`backend/src/config/env.validation.ts`** (Joi) *and*
**`backend/.env.example`**. ⚠️ Joi runs with `whitelist`, so a var missing from the schema is
invisible to `ConfigService` no matter what `.env` says.

| Var | Default | Purpose |
|---|---|---|
| `SEND_ALLOW_PRIVATE_NETWORK` | `false` | Disable the private-address check. Local dev only. |
| `SEND_CONNECT_TIMEOUT_MS` | `10000` | Socket connect timeout. |
| `SEND_TOTAL_TIMEOUT_MS` | `30000` | Whole-operation timeout, redirects and body included. |
| `SEND_MAX_REDIRECTS` | `5` | Hop cap. Each hop re-runs the SSRF check. |
| `SEND_MAX_RESPONSE_BYTES` | `5242880` | Streamed byte cap; overflow truncates, never errors. |
| `SEND_HISTORY_PER_REQUEST` | `50` | Rows kept per request; pruned in the insert's transaction. |
| `SEND_THROTTLE_BURST_TTL_MS` / `_LIMIT` | `60000` / `30` | Send's own burst window. |
| `SEND_THROTTLE_SUSTAINED_TTL_MS` / `_LIMIT` | `3600000` / `600` | Send's own sustained window. |

---

## Phasing

| Phase | What works after it |
|---|---|
| 1. Contracts | Nothing runs; both sides compile against the new types. `./dev.sh contracts`. |
| 2. Interpolation | `yarn test` green on a pure module with no callers. |
| 3. HTTP client + SSRF | Same — pure modules, unit-tested, no route yet. |
| 4. Endpoint + entity + migration + active env | `curl POST /requests/:id/send` returns a real response; history accumulates. **The backend engine is done here.** |
| 5. Frontend | Send button, response pane, history pane, environment picker and editor. |

Phases 1–4 are shippable without any frontend change. Phase 5 is where the user-visible
feature appears.

---

## Non-goals, stated so they are not mistaken for oversights

- **Scripts still do not execute.** `node:vm` is not a security boundary and a real sandbox
  (isolated-vm, QuickJS-wasm) is a native/wasm dependency plus an API surface — its own
  slice.
- **No cookie jar, no proxy config, no client certificates, no file uploads** —
  `multipart/form-data` is not a `RequestBodyMode` today and adding one is a contract change.
- **No streaming / SSE / WebSocket responses.** The engine buffers to a cap.
- **No request cancellation from the UI** beyond the server-side total timeout.
- **The preference is per member, not per device** — deliberately the opposite of the theme,
  because an environment selects *which server you are about to hit* and that should follow
  you between machines.

---

## Verification

```bash
./dev.sh contracts                 # after every packages/contracts edit — non-optional
cd backend && yarn migration:run
cd backend && yarn test            # interpolate.spec, ssrf.spec, execution.service.spec
cd backend && yarn test:e2e        # needs live Postgres; --runInBand
cd frontend && yarn contrast       # must be green on all five themes
cd frontend && yarn build && yarn lint
```

**New e2e — `backend/test/execution.e2e-spec.ts`**, against a local `http.createServer`
fixture so nothing touches the public internet:

- 200 with a JSON body → `outcome: 'response'`, body and headers intact.
- Target returns 500 → still **HTTP 200** from our API with `outcome: 'response'`, `status: 500`.
- Connection refused → **HTTP 200**, `outcome: 'error'`, `reason: 'connect'`.
- `http://127.0.0.1/` with `SEND_ALLOW_PRIVATE_NETWORK=false` → `outcome: 'error'`,
  `reason: 'blocked'`, and **assert no socket was opened** (the fixture records connections).
- A public-looking host that 302s to a loopback address → blocked on the hop.
- A cross-origin redirect → assert `Authorization` was **not** forwarded.
- A response larger than the cap → `truncated: true`, not an error.
- `{{baseUrl}}` with and without an active environment → resolved, vs. a `warnings` entry
  naming `baseUrl`.
- Another user's request id → **404** (not 403 — no enumeration oracle), via `explainDenial`.
- An environment from a different workspace → rejected.
- History caps at `SEND_HISTORY_PER_REQUEST` after N+1 sends.

**Manual, with `SEND_ALLOW_PRIVATE_NETWORK=true`:** `./dev.sh`, create an environment with
`baseUrl`, select it in the header, put `{{baseUrl}}/health` in a request, Send, and confirm
the response pane, the status pill in each of the five themes, and the history tab.

---

## Documentation to update in the same change

- `backend/.env.example` — every new var, with the same commented rationale the existing
  `THROTTLE_*` block carries. ⚠️ A var added to `env.validation.ts` but not here is invisible
  to the next person who copies the example.
- `README.md` — replace the "Sending requests is out of scope here" section; document the
  send envelope, the SSRF policy and its env var, every new `SEND_*` var, and **add
  `request_executions` to the plaintext-secrets warning**.
- `CLAUDE.md` — new *Execution* section carrying the traps above; update *Current state*;
  update the `tagTypes` list to include `Environment`; note that the environment UI now
  exists.
- `RequestUrlBar.tsx` — delete the no-Send-button comment. `ScriptsTab.tsx` — reword the
  banner to be about scripts, not about sending.
