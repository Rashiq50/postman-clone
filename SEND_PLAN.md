# Send — the request execution engine

## Context

The app stores requests but cannot fire them. `RequestEditor` is a complete Postman/Bruno-style
editor — method, URL, params, headers, body, auth, scripts — and every one of those fields
round-trips to Postgres and is never used. [RequestUrlBar.tsx](frontend/src/features/requests/RequestUrlBar.tsx)
carries a standing comment saying there is deliberately no Send button, and the README lists Send
as the next slice with its budget stated: *"SSRF, redirect handling, timeouts and response size
caps"*. The `environments` table, contracts and CRUD already exist with **no frontend at all**, for
the reason the README gives: *"an environment editor without interpolation is a form with no
observable effect."*

This slice closes both gaps at once. After it, a user picks an environment, presses Send, and sees
a real response — and the environment UI finally has an observable effect.

Scope decisions taken up front:

| Decision | Choice |
|---|---|
| `{{var}}` interpolation | **In.** Full environment UI + active-environment persistence. |
| Script execution | **Out.** `RequestScripts` stays stored-only; `ScriptsTab`'s banner stays (reworded). |
| SSRF | **Env-gated.** Resolve → screen every address → pin the socket. Blocking on by default; `SEND_ALLOW_PRIVATE_NETWORK=true` disables it for local dev. |
| History | **In.** `request_executions` table + a history pane + two retention policies. |

### Ground rules this plan holds itself to

- Every contract edit is followed by `./dev.sh contracts`, or both sides compile against a stale copy.
- No TS `enum` in contracts — `as const` objects only (`erasableSyntaxOnly`).
- No authorization guard. Every new query carries membership in its `WHERE` via
  [workspace-scope.ts](backend/src/workspaces/workspace-scope.ts); every miss goes through
  `explainDenial` / `explainParentDenial`.
- No entity returned from a controller. Every response DTO is `@Expose()`-only, built with
  `excludeExtraneousValues`, and carries `implements <ContractType>`.
- Every new env var lands in [env.validation.ts](backend/src/config/env.validation.ts) (Joi,
  `whitelist` on) **and** [backend/.env.example](backend/.env.example).
- Every new colour is a semantic token in all five theme blocks of
  [index.css](frontend/src/index.css), in the `@theme inline` map, and in `PAIRS` in
  [check-contrast.mjs](frontend/scripts/check-contrast.mjs).
- **No new dependency, backend or frontend.** See §3.1 — the transport is `node:http`/`node:https`.

---

## The one idea that shapes everything

**A failed upstream request is not an API error of ours.** `POST /requests/:id/send` answers **200**
whether the target returned 200, returned 500, refused the connection, or was blocked before a
socket opened. The result is a union discriminated on `outcome`:

```ts
result: { outcome: 'response'; status; headers; body; … }
      | { outcome: 'failure';  kind: SendFailureKind; message: string }
```

Our error envelope (`{ error: { code, … } }`) is reserved, strictly, for **our** failures:
malformed DTO (400), request not visible (404) or role too low (403), environment not visible (404),
rate limited (429), unexpected throw (500 `INTERNAL`). Nothing about the upstream ever produces one.

Getting this wrong is the trap the README already flags — `toApiError()` returns `null` when the
failure never reached our API, precisely so a proxy error is not reported as if the API had spoken.
Collapsing upstream failures into `ApiException` would make a 500 from `httpbin.org`
indistinguishable from our own backend crashing, would force the client to branch on our HTTP
status, and would mean the response pane could never show a 4xx body — which is most of what a
person presses Send to look at. It would also make history and the live pane need two renderers for
one concept.

Put that sentence at the top of `execution.controller.ts`.

---

## 1. Contracts

### 1.1 New file: `packages/contracts/src/execution.ts`

```ts
export const SEND_FAILURE_KINDS = [
  'invalid-url',        // after interpolation: unparseable, or an unsupported scheme
  'blocked-address',    // the SSRF policy refused a resolved address
  'dns',                // NXDOMAIN, SERVFAIL
  'connect',            // ECONNREFUSED, EHOSTUNREACH, connect timeout
  'tls',                // certificate / handshake
  'timeout',            // the total deadline elapsed
  'too-many-redirects',
  'invalid-header',     // CR/LF or a forbidden header, after interpolation
  'aborted',            // the socket died mid-body
  'unknown',
] as const
export type SendFailureKind = (typeof SEND_FAILURE_KINDS)[number]

export const SEND_WARNING_KINDS = [
  'unresolved-variable',
  'header-overridden-by-auth',
  'body-on-bodyless-method',
  'body-truncated',
  'stored-body-truncated',
  'auth-stripped-on-cross-origin-redirect',
] as const
export type SendWarningKind = (typeof SEND_WARNING_KINDS)[number]

export interface SendWarning {
  kind: SendWarningKind
  /** Human-readable; the client renders it verbatim. Branch on `kind`. */
  message: string
}

/** ⚠️ Ordered pairs, not a map and not `KeyValueEntry`: `set-cookie` repeats,
 *  and an `enabled` flag is meaningless on a response. */
export interface ResponseHeader { name: string; value: string }

export type ResponseBodyPayload =
  | { encoding: 'text'; text: string }
  | { encoding: 'base64'; base64: string }
  | { encoding: 'empty' }

/** ⚠️ The phase fields describe the **final hop only**. A `tlsMs` summed across
 *  five redirects would mean nothing. `totalMs` spans everything. */
export interface SendTiming {
  totalMs: number
  dnsMs: number | null       // null for a literal IP
  connectMs: number | null
  tlsMs: number | null       // null for plain http
  firstByteMs: number | null
}

export interface RedirectHop { status: number; from: string; to: string }

export interface SendResponse {
  outcome: 'response'
  status: number
  statusText: string
  headers: ResponseHeader[]
  body: ResponseBodyPayload
  bodyBytes: number
  bodyTruncated: boolean
}

export interface SendFailure {
  outcome: 'failure'
  kind: SendFailureKind
  /** Safe for a user. Never a stack, never a raw errno or driver dump. */
  message: string
}

export interface SendResult {
  /** Null only when the history insert failed. The send still happened. */
  executionId: string | null
  requestId: string
  /** The final URL after interpolation and redirects, secret-redacted. */
  url: string
  method: HttpMethod
  environmentId: string | null
  usedDraft: boolean
  redirects: RedirectHop[]
  warnings: SendWarning[]
  timing: SendTiming
  startedAt: string
  result: SendResponse | SendFailure
}

/** The editable subset a send may carry instead of the saved row. */
export interface SendDraft {
  method?: HttpMethod
  url?: string
  headers?: KeyValueEntry[]
  queryParams?: KeyValueEntry[]
  body?: RequestBody
  auth?: RequestAuth
}

export interface SendRequestInput {
  /** Omitted → the caller's active environment. `null` → none. */
  environmentId?: string | null
  /** Omitted → the saved row is sent. */
  draft?: SendDraft
}

/** History list row — no body, so the list stays cheap. */
export interface RequestExecutionSummary {
  id: string
  requestId: string
  method: HttpMethod
  url: string
  outcome: 'response' | 'failure'
  status: number | null
  statusText: string | null
  failureKind: SendFailureKind | null
  durationMs: number
  bodyBytes: number | null
  usedDraft: boolean
  createdAt: string
}

/** One stored run, in full. Its body is capped separately from the live one. */
export interface RequestExecution extends RequestExecutionSummary {
  environmentId: string | null
  headers: ResponseHeader[]
  body: ResponseBodyPayload
  bodyTruncated: boolean
  redirects: RedirectHop[]
  warnings: SendWarning[]
  timing: SendTiming
  failureMessage: string | null
}
```

#### Why `draft` exists

The editor has no autosave. Without it, Send would fire the *last saved* request while the user
looks at their edits — the single most confusing possible behaviour. The alternative, forcing a save
on Send, silently writes to disk on what the user reads as a read-only action. So the client posts
its dirty draft, the server merges `{ ...stored, ...draft }`, and records `usedDraft` — ⚠️ otherwise
the history row silently claims something was sent that was never saved. `SendDraft` deliberately
carries no `collectionId` or `folderId`, so it cannot reparent anything; the stored row remains the
authorization anchor.

### 1.2 `packages/contracts/src/workspace.ts`

Add one field to `Workspace`, mirroring the doc comment already on `role`:

```ts
  /**
   * The **caller's** active environment in this workspace, from their
   * `workspace_members` row — not a property of the workspace. Null means
   * "no environment"; `{{var}}` then resolves to nothing and warns.
   */
  activeEnvironmentId: string | null
```

plus `export interface SetActiveEnvironmentInput { environmentId: string | null }`.

### 1.3 `packages/contracts/src/error.ts` — **no new codes**

Deliberate. Every send outcome that is *about the upstream* is a 200 `SendResult`, so there is
nothing for a new code to describe. A `SEND_BLOCKED` code would create two ways to express one
concept and split the client's rendering into two paths. **Record that reasoning in the file** so a
future reader does not "complete" the enum.

### 1.4 Prose to delete

`environment.ts` — the "deferred / no UI in this slice" paragraph becomes false; replace it with the
resolution rules (enabled-only, later-source-wins, no rescanning). `request.ts` — the
`RequestScripts` note saying nothing executes them **stays true** and stays. Keep the plaintext ⚠️
in both.

### 1.5 `index.ts`

`export * from './execution'`. Then **`./dev.sh contracts`**.

---

## 2. Interpolation

Files, all pure — no Nest, no DB, no I/O:
`backend/src/execution/interpolate.ts` + spec, `backend/src/execution/redact.ts` + spec.

### Syntax

`{{name}}`, matched by `/\{\{([^{}]*)\}\}/g`. The captured name is `.trim()`ed (people type
`{{ baseUrl }}`) and looked up **case-sensitively**. `{{` with no closing `}}` is left untouched.

### There is no escape, on purpose

The load-bearing property is **one pass, no rescanning**: a substituted value that itself contains
`{{x}}` is emitted literally and never re-expanded. That closes recursion, expansion bombs, and
variable-injection-through-a-variable in one stroke, and it is far cheaper to reason about than an
escape character. The cost is real and must be documented rather than hidden: a literal `{{token}}`
in a body is unrepresentable. That is an accepted limitation of this slice, not an oversight.

### Sources and merge order

The signature takes an **ordered list of scopes** even though only one exists today, so
collection- and request-level variables later cost a merge rather than a rewrite:

```ts
export interface VariableScope {
  name: 'environment' | 'collection' | 'global'
  variables: EnvironmentVariable[]
}
export function buildVariables(
  scopes: VariableScope[],
): Map<string, { value: string; secret: boolean }>
```

Rules, each with a test:

1. ⚠️ **Disabled rows are dropped before merging, not after.** A disabled row in a
   higher-precedence scope must not shadow an enabled row below it — that is the bug that presents
   as *"my variable stopped working when I unticked the other one"*.
2. Later scopes win. Today the list is `[environment]`.
3. Duplicate keys within one scope: **last wins**, matching the visual order of the editor rows.
4. An empty-string value is a legitimate value, not an absence.

### Unresolved variables

**Leave the placeholder literally in place and emit a `SendWarning`.** Not a hard failure, not
silence.

- Failing hard would make a literal `{{` anywhere in a body an unsendable request.
- Silence is the actual bug: a typo'd variable would send to the wrong place with no signal.
- ⚠️ Substituting the empty string is the worst of the three — `{{baseUrl}}/users` becomes
  `/users`, a request against a *different host* that may well succeed.
- In practice the URL case self-enforces: `https://{{host}}/x` fails `new URL()` and returns
  `outcome: 'failure', kind: 'invalid-url'` — the loud failure, exactly where it matters. Elsewhere
  (a header value, a body field) a warning is the right weight.

The warning names the variable and where it appeared (`url`, `header "X-Api-Key"`, `query "page"`,
`body`, `auth`), deduplicated by (name, location).

### Application surface

`interpolateRequest(draft, vars)` → `{ resolved, warnings, secretValues: Set<string> }`, touching in
this order:

| Where | Rule |
|---|---|
| `url` | interpolated first, then parsed. Parse failure → `invalid-url`. |
| `queryParams` | enabled rows only; key **and** value; **appended** to the URL's existing search via `URLSearchParams.append`, duplicates preserved (Postman behaviour). |
| `headers` | enabled rows only; key and value; then validated — see §3.6. |
| `body` | `raw`/`json` → the whole text; `form-urlencoded` → each enabled row's key and value; `none` → nothing. |
| `auth` | every string field: bearer token, basic user/pass, apiKey key/value. |

`secretValues` collects every substituted value whose source variable had `secret: true`.
`redact.ts` masks each occurrence with `••••••` in anything we **store** (chiefly the history row's
`url`), so `?token={{apiKey}}` does not sit in the history list forever. ⚠️ A mitigation, not
encryption — secrets remain plaintext in `environments.variables` and in the live response.

### `auth.type === 'inherit'` resolves to `none`

There is no collection-level auth to inherit from, so the honest behaviour is to send nothing.
`inherit` stays a distinct choice in the editor because it is the reserved spelling for collection
auth when it lands — the seam stays visible. **No warning is emitted**: `RequestsService.create`
defaults every new request to `{ type: 'inherit' }`, so a warning would fire on essentially
everything and train users to ignore the warnings strip.

### Auth beats a hand-written header

Auth-derived headers are applied **after** user headers and overwrite a same-named one, emitting
`header-overridden-by-auth`. `apiKey` with `in: 'query'` appends a query param under the same rule.

---

## 3. The HTTP client layer

Under `backend/src/execution/`: `ssrf.ts`, `http-client.ts`, `send-options.ts`, each with a spec.

### 3.1 `node:http` / `node:https`, **not** undici or `fetch`

`undici` is **not installed** (only `undici-types`, a `@types/node` transitive — verified by
`require('undici')` failing with `MODULE_NOT_FOUND`). Node 24 exposes `fetch` globally but does
*not* expose undici's `Agent`, so pinning through `Agent({ connect: { lookup } })` would mean a new
production dependency.

`http.request`/`https.request` forward unknown options through the agent to `net.connect` /
`tls.connect`, which accept a **`lookup`** option with the `dns.lookup` signature. That is the pin,
with zero new dependencies — and crucially it keeps SNI and the `Host` header derived from the
*hostname*, so certificate validation stays correct. Setting `host: <ip>` by hand instead is what
breaks TLS verification.

We also need manual redirects, suppressed decompression, and byte-capped streaming — all of which
mean fighting `fetch` rather than using it.

> **Verify while building:** that `lookup` survives to the socket. Pass `agent: false` (a fresh
> agent per send; pooled sockets across tenants are not wanted anyway) and assert in a unit test
> that a `lookup` returning `127.0.0.1` actually connects there.

### 3.2 The address policy — `ssrf.ts`

```ts
export function isBlockedAddress(ip: string): boolean          // pure, table-tested
export async function resolveAndScreen(hostname: string, opts): Promise<string[]>
```

`isBlockedAddress` covers, with a spec case each:

| IPv4 | |
|---|---|
| `0.0.0.0/8` | "this host" |
| `10/8`, `172.16/12`, `192.168/16` | RFC1918 |
| `127/8` | loopback |
| `169.254/16` | link-local — **including `169.254.169.254`**, the cloud metadata endpoint |
| `100.64/10` | CGNAT |
| `192.0.0/24`, `192.0.2/24`, `198.18/15`, `198.51.100/24`, `203.0.113/24` | special-use |
| `224/4`, `240/4`, `255.255.255.255` | multicast / reserved / broadcast |

| IPv6 | |
|---|---|
| `::`, `::1` | unspecified, loopback |
| `fc00::/7` | unique-local |
| `fe80::/10` | link-local |
| `ff00::/8` | multicast |
| `fd00:ec2::254` | AWS IMDSv6 |
| `::ffff:a.b.c.d` | **unwrap, re-check as IPv4** |
| `64:ff9b::/96` | NAT64 — unwrap, re-check |
| `2002::/16` | 6to4 — extract the embedded IPv4, re-check |

⚠️ The unwrapping cases are where naive implementations lose: `http://[::ffff:127.0.0.1]/`,
`http://[64:ff9b::7f00:1]/` and `http://[2002:7f00:1::]/` all reach loopback while passing a
v6-only range check.

`resolveAndScreen(hostname)`:

1. `net.isIP(hostname)` non-zero → it *is* a literal; screen it, return `[it]`, no DNS.
   ⚠️ **Screen `url.hostname`, never the raw input.** `new URL()` normalizes decimal, octal and hex
   IPv4 forms for `http:` (`http://2130706433/` → `127.0.0.1`), which is what makes those forms
   safe — pin a spec case on each of `2130706433`, `0177.0.0.1`, `0x7f.1`.
2. Otherwise `dns.promises.lookup(hostname, { all: true, verbatim: true })`.
3. **Every** returned address is screened; if *any* is blocked the whole send fails
   `blocked-address`. ⚠️ Not "filter and use the survivors" — a name resolving to both a public and
   a private address is a rebinding attack, and picking the public one only delays it.
4. Return the screened list; the caller pins `[0]`.
5. `SEND_ALLOW_PRIVATE_NETWORK=true` skips step 3 only. DNS still runs, the pin still happens. Log
   a `warn` once at boot when it is on, so nobody ships it by accident.

Scheme allow-list: `http:` and `https:` only. Everything else → `invalid-url`. No `file:`, no
`ftp:`, no `data:`.

### 3.3 The pin — no TOCTOU

```ts
const pinned = screened[0]
const lookup: LookupFunction = (_host, options, cb) =>
  options?.all
    ? cb(null, [{ address: pinned, family: net.isIPv6(pinned) ? 6 : 4 }])
    : cb(null, pinned, net.isIPv6(pinned) ? 6 : 4)
```

Belt and braces: on the socket's `connect` event assert `socket.remoteAddress === pinned` and
`socket.destroy()` otherwise. It costs nothing and it is the assertion that catches a future
refactor that drops the `lookup`.

⚠️ **Every redirect hop repeats §3.2 and gets its own pin.** A redirect is a fresh connection to a
fresh name; reusing the previous screening is the same TOCTOU hole in a different coat.

### 3.4 Redirects — manual, never delegated

- Cap `SEND_MAX_REDIRECTS` (default 5) → `too-many-redirects`.
- `Location` resolved against the *current* URL: `new URL(location, current)`.
- 301/302 on POST → GET, body dropped. 303 → GET, body dropped. 307/308 → method and body replayed
  verbatim (we buffer the outgoing body anyway, so a replay is free).
- ⚠️ **A cross-origin hop (scheme, host or port differs) strips `Authorization`, `Cookie`,
  `Proxy-Authorization` and any apiKey header we injected**, emitting
  `auth-stripped-on-cross-origin-redirect`. Forwarding a bearer token to whatever host a redirect
  names is a credential-exfiltration primitive, and it is the default behaviour of every naive
  implementation.
- Every hop is recorded as a `RedirectHop` and returned — exactly the debugging output a Postman
  user wants, for the cost of one array push.
- ⚠️ The total deadline spans **all** hops. A per-hop timeout under a 5-hop cap is a 5× timeout.

### 3.5 Timeouts, sizes, encodings

| Knob | Default | Enforced by |
|---|---|---|
| `SEND_CONNECT_TIMEOUT_MS` | 5000 | `socket.setTimeout` armed on `'socket'`, cleared on `'connect'`/`'secureConnect'` |
| `SEND_TOTAL_TIMEOUT_MS` | 30000 | one absolute deadline across hops; `req.destroy()` → `kind: 'timeout'`. This is also what bounds a slowloris response body, which a connect timeout does not. |
| `SEND_MAX_RESPONSE_BYTES` | 5 MiB | a byte counter in the `'data'` handler |
| `SEND_MAX_STORED_BODY_BYTES` | 256 KiB | applied when writing history only |
| `SEND_MAX_REQUEST_BODY_BYTES` | 1 MiB | checked after interpolation, before connect |

**Overflow is a success, not a failure.** On exceeding the response cap: destroy the socket, keep
what arrived, set `bodyTruncated: true`, warn `body-truncated`, and return `outcome: 'response'`
with the real status and headers. The status line already arrived and is the useful part; turning it
into a failure throws away the answer.

⚠️ **The cap is on *decompressed* bytes.** Send `accept-encoding: identity` by default — a cap on
compressed bytes is not a cap, and a 5 MiB gzip is a gigabyte of RAM. If the server compresses
anyway, decompress through `zlib` with **`maxOutputLength: SEND_MAX_RESPONSE_BYTES`** (a real
`zlib` option: it errors rather than allocating) and treat that error as truncation, not failure.

**Binary / non-UTF-8**, after buffering:

1. No body → `{ encoding: 'empty' }`.
2. A `charset` in `content-type` that `TextDecoder` supports → decode with `{ fatal: true }`.
3. No charset → try `new TextDecoder('utf-8', { fatal: true })`. Success → `text`; throw → `base64`.
4. A known-binary content type (`image/*`, `application/octet-stream`, `application/pdf`, `audio/*`,
   `video/*`, `font/*`) → `base64` without attempting a decode.

⚠️ **Never use `buf.toString('utf8')` as the test.** It substitutes U+FFFD for invalid bytes and so
always "succeeds", which turns every JPEG into mojibake text. `TextDecoder` with `fatal: true` is
the test. This also matters downstream: Postgres rejects a ` ` byte in a jsonb/text column, so
a body that is not really text is a 500 on the history insert, not merely an ugly pane.

**Body assembly.** `json` sends the raw text with `Content-Type: application/json` **without
re-serialising** — the user's formatting, and their deliberately malformed JSON, are both the point
of a testing tool. `form-urlencoded` builds `URLSearchParams` from enabled entries. `raw` sends the
text as `text/plain`. In every case a user-supplied `Content-Type` header wins.

### 3.6 Header validation — the injection hole

After interpolation, **before** anything is written to a socket:

- Reject any header name not matching the RFC 9110 token set
  ``/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/``.
- Reject any value containing `\r`, `\n` or `\0`.
- Refuse user-set `Host`, `Content-Length`, `Connection`, `Transfer-Encoding`, `Upgrade`, `TE` —
  the transport owns these.

Failure → `outcome: 'failure', kind: 'invalid-header'`, naming the header.

⚠️ **This exists *because of* interpolation.** A saved request is authored by a human, but
`{{token}}` can carry `x\r\nX-Admin: 1` straight out of an environment variable. Node's own header
validation catches much of this by throwing `ERR_INVALID_CHAR` — but relying on a thrown internal
error to be the security boundary is exactly the thing that quietly stops being true across a Node
upgrade.

### 3.7 Timing

`process.hrtime.bigint()` snapshots at start → `'lookup'` → `'connect'` → `'secureConnect'` →
request written → `'response'` (first byte) → `'end'`.

### 3.8 `send-options.ts` — and why it decides the e2e suite

Mirroring `buildThrottlerOptions` exactly:

```ts
export const SEND_OPTIONS = Symbol('SEND_OPTIONS')
export interface SendOptions { allowPrivateNetwork: boolean; connectTimeoutMs: number; /* … */ }
export function buildSendOptions(config: ConfigService): SendOptions
```

⚠️ **Not decoration.** `ConfigModule.forRoot()` reads and validates the environment at `@Module`
*decorator-evaluation* time, so `process.env.SEND_ALLOW_PRIVATE_NETWORK = 'true'` at the top of a
spec is always too late — the identical trap already recorded for `THROTTLER_OPTIONS`.
`send.e2e-spec.ts` runs a real `http.createServer` on `127.0.0.1`, which the default policy blocks,
so it must flip the policy by **overriding the `SEND_OPTIONS` provider**, never `process.env`.

---

## 4. The send endpoint

New module `backend/src/execution/` (`execution.module.ts`, `execution.controller.ts`,
`execution.service.ts`, `executions.service.ts`), registered in `app.module.ts`.

```
POST   /api/v1/requests/:id/send         → 200 SendResult
GET    /api/v1/requests/:id/executions   → 200 Paginated<RequestExecutionSummary>
DELETE /api/v1/requests/:id/executions   → 204
GET    /api/v1/executions/:id            → 200 RequestExecution
```

Nested under the request because `:id` is the only id in play — the precedent is
`/workspaces/:id/tree` and `/workspaces/:id/environments`. Two controllers where the paths diverge,
following `WorkspaceEnvironmentsController`.

**200, not 201.** The addressed thing is the run; the history row is a side effect. Same reasoning
that makes login 200 while register is 201 — the resource is what the caller asked for.

### DTO — `dto/send-request.dto.ts`

```ts
export class SendRequestDto implements SendRequestInput {
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID()
  environmentId?: string | null

  @IsOptional() @ValidateNested() @Type(() => SendDraftDto)
  draft?: SendDraftDto
}
```

`SendDraftDto` reuses [json-constraints.ts](backend/src/requests/dto/json-constraints.ts) verbatim
(`KeyValueEntriesConstraint`, `RequestBodyConstraint`, `RequestAuthConstraint`).

⚠️ `@ValidateNested` is safe **here** and forbidden **there**, and the difference is worth restating
in the file: `whitelist` strips keys a decorated nested class does not declare, so a nested class
over a *union* mangles a saved body — but `SendDraftDto` declares flat top-level fields whose values
are checked by `@Validate(...)` as plain objects, and plain objects pass through untouched.

### Scoping and roles

- The request is loaded through `scopedWhere(REQUEST_SCOPE, 'r')` with **`READ_ROLES`**; denial via
  `explainDenial`. **Sending is a read-like act**: a VIEWER can already read the URL and the
  plaintext bearer token out of `GET /requests/:id`, so refusing them Send leaks nothing and buys
  nothing. The counter-argument — send consumes *our* egress and hits third parties from our IP —
  is answered by the SSRF policy and the per-user throttle, not by the role table. Record both
  sides; reversing it is one constant.
- Clearing history is **`WRITE_ROLES`** — it destroys shared data.
- ⚠️ **The environment must be re-scoped *and* confirmed to belong to the request's workspace.**
  Resolving `environmentId` through `ENVIRONMENT_SCOPE` alone is not enough: a member of two
  workspaces could otherwise inject workspace B's variables into a send from workspace A. The check
  is one predicate — `e."id" = :envId AND e."workspaceId" = :ws AND <ENVIRONMENT_SCOPE>` — and a
  miss is a 404 naming the environment.

### Throttling — its own budget, keyed on the user

`ApiThrottlerGuard`'s windows (`burst` 5/min, `sustained` 20/hr) are sized for register. Send on
that budget is unusable; unthrottled, an authenticated account is a free scanning proxy.

1. Extract `backend/src/common/throttling/throttling.module.ts` holding the
   `ThrottlerModule.forRootAsync` currently inside `AuthModule`, and **export** it. `AuthModule` and
   `ExecutionModule` both import it. ⚠️ Registering `forRootAsync` twice gives two independent
   storages.
2. Add `sendBurst` / `sendSustained` to `buildThrottlerOptions` from `SEND_THROTTLE_*` vars
   (defaults 30/min, 600/hr), with cases in `throttler.config.spec.ts`.
3. `@SkipThrottle({ sendBurst: true, sendSustained: true })` on `register`;
   `@SkipThrottle({ burst: true, sustained: true })` on `send`.
   > **Verify:** per-name `@SkipThrottle` in `@nestjs/throttler@6.5`. Fallback is a second
   > `ThrottlerGuard` subclass constructed with only the send windows.
4. `SendThrottlerGuard extends ApiThrottlerGuard`, overriding `getTracker` to key on
   `request.user.userId` (falling back to `req.ip`). Every caller here is authenticated, and `req.ip`
   is the *proxy's* address because `trust proxy` is off — per-IP would collapse every user into one
   bucket.

### The history write

```ts
try { executionId = await this.executions.record(...) }
catch (e) { this.logger.error(...); executionId = null }
```

⚠️ **A failed insert must never turn a successful send into an error.** The request already left the
building; a 500 here would tell the user their send failed when it did not, and would invite a retry
that fires the upstream call twice.

---

## 5. `request_executions`

### Entity — `backend/src/execution/entities/request-execution.entity.ts`

`id uuid pk`; `request` ManyToOne `RequestEntity` `onDelete: 'CASCADE'`
(`FK_request_executions_requestId`) + `@RelationId requestId`; `user` ManyToOne `UserEntity`
`onDelete: 'SET NULL'`, nullable; `environmentId uuid nullable` (**a plain column, no FK** — an
execution is a historical fact and must survive its environment's deletion); `method varchar(10)`;
`url text`; `outcome varchar(16)`; `status integer null`; `statusText text null`;
`failureKind varchar(32) null`; `failureMessage text null`; `usedDraft boolean default false`;
`bodyEncoding varchar(8) null`; `body text null`; `bodyBytes integer null`;
`bodyTruncated boolean default false`; `durationMs integer`; jsonb `headers`, `warnings`,
`redirects`, `timing`; `createdAt timestamptz`.

`@Check('CHK_request_executions_outcome', `"outcome" IN ('response','failure')`)` — `varchar` +
`CHECK`, never a Postgres enum, per `WorkspaceMemberEntity.role`'s note.

⚠️ **jsonb defaults: SQL expression, no `::jsonb` cast, spelled the way Postgres normalizes.**
Four new jsonb columns are four chances to emit `migration:generate` churn forever:

```ts
@Column({ type: 'jsonb', default: () => `'[]'` })  headers: ResponseHeader[]
@Column({ type: 'jsonb', default: () => `'[]'` })  warnings: SendWarning[]
@Column({ type: 'jsonb', default: () => `'[]'` })  redirects: RedirectHop[]
@Column({ type: 'jsonb', default: () => `'{}'` })  timing: SendTiming
```

The migration side writes `'[]'::jsonb` / `'{}'::jsonb`, matching `AddRequestScripts`.

**No `position` column.** Ordering is `createdAt DESC, id DESC`; there is nothing to drag.

### Migration — `<ts>-AddRequestExecutions.ts`, hand-written

Not generated, for the reason recorded on `AddRequestScripts`: `migration:generate` cannot express
`FK_folders_parent` / `FK_requests_folder` and proposes replacing them with single-column FKs on
every run, so a generated file arrives carrying a schema regression that must be edited out.

```sql
CREATE INDEX "IDX_request_executions_requestId_createdAt"
  ON "request_executions" ("requestId", "createdAt" DESC);
CREATE INDEX "IDX_request_executions_createdAt"
  ON "request_executions" ("createdAt");
```

The first serves the history pane and the per-request prune; the second serves the age sweep.

### Scoping — a new fragment, not a denormalized column

In [workspace-scope.ts](backend/src/workspaces/workspace-scope.ts):

```ts
export type ScopeVia = 'collection' | 'workspace' | 'self' | 'request'

// in scopedWhere():
case 'request':
  return `${prefix}"requestId" IN (
    SELECT r."id" FROM "requests" r WHERE r."collectionId" IN (${SCOPED_COLLECTION_IDS})
  )`

export const REQUEST_EXECUTION_SCOPE: ScopedResource = {
  resourceName: 'Execution', via: 'request',
}
```

Preferable to denormalizing `workspaceId` onto the row: it keeps *"authorization lives in one
fragment used by both the hot path and `explainDenial`"* literally true, with no second copy of the
tenancy fact to drift. Add a case to `workspace-scope.spec.ts` — that file is a pinned contract.

### Retention — two policies

1. **Per-request cap**, `SEND_HISTORY_PER_REQUEST` (default 50), enforced **inside the insert's
   transaction, after the insert, as one set-based statement** — precisely the shape
   `MAX_SESSIONS_PER_USER` uses in `SessionsService.create`:

   ```sql
   DELETE FROM "request_executions"
   WHERE "requestId" = $1 AND "id" NOT IN (
     SELECT "id" FROM "request_executions" WHERE "requestId" = $1
     ORDER BY "createdAt" DESC, "id" DESC LIMIT $2
   )
   ```

   ⚠️ `id` is the tiebreaker because two sends inside one millisecond otherwise make the ordering
   non-deterministic and the delete non-idempotent.

2. **Age sweep**, `deleteExpiredExecutions()` against `SEND_HISTORY_RETENTION_DAYS` (default 30) —
   **implemented, unit-tested and deliberately uncalled**, exactly like
   `SessionsService.deleteExpiredSessions()`. `@nestjs/schedule` is still not a dependency and this
   slice does not make it one. Say so in the method's doc comment so nobody "fixes" the dead code.

⚠️ **Bodies are the growth driver**: `SEND_MAX_STORED_BODY_BYTES` × 50 runs × N requests. The stored
body is capped separately and much lower than the live one, and `stored-body-truncated` is a warning
on the record, not on the live result.

⚠️ **This table is a *third* plaintext-secrets location**, beyond `requests.auth` and
`environments.variables` — it holds the `Authorization` header the engine just built, and response
bodies. `redact.ts` covers the stored `url` only. The README's plaintext warning must name it in the
same change; the row cap limits the blast radius, it does not remove it.

---

## 6. Active environment persistence

### Migration — `<ts>-AddActiveEnvironment.ts`, hand-written

```sql
ALTER TABLE "workspace_members" ADD "activeEnvironmentId" uuid;
ALTER TABLE "workspace_members"
  ADD CONSTRAINT "FK_workspace_members_activeEnvironmentId"
  FOREIGN KEY ("activeEnvironmentId") REFERENCES "environments"("id")
  ON DELETE SET NULL;
```

⚠️ **`ON DELETE SET NULL`, and this is the single most dangerous line in the migration.** `CASCADE`
here deletes the *membership row* when an environment is deleted — a user silently evicted from a
workspace because someone tidied up an environment, with no repair path, since there is no invite
endpoint. `RESTRICT` would make an environment undeletable while anyone had it selected. `SET NULL`
degrades to "no environment", which is exactly the recoverable state.

No index: the row is reached by the existing `UQ_workspace_members_workspace_user`.

### Entity

`WorkspaceMemberEntity` gains a nullable `ManyToOne(() => EnvironmentEntity, { onDelete: 'SET NULL',
nullable: true })` with `@JoinColumn({ name: 'activeEnvironmentId', foreignKeyConstraintName: … })`
and a `@RelationId`.

> **Verify:** this introduces a `workspaces/` → `environments/` **entity** import, and
> `EnvironmentEntity` already imports `WorkspaceEntity`. Entities are not modules and
> `autoLoadEntities` handles the pair, but check for a TypeScript circular-import warning. If it
> bites, fall back to a plain `@Column({ type: 'uuid', nullable: true })` with the FK owned by the
> migration — `workspaces.organizationId` is the precedent.

### Read path — one line

`WORKSPACE_SELECT` in [workspaces.service.ts](backend/src/workspaces/workspaces.service.ts) gains
`'m."activeEnvironmentId" AS "activeEnvironmentId"'`, and `WorkspaceWithRole` gains the field. Both
readers (`findAll`, `findOne`) get it for free — that constant exists so they cannot drift.
`WorkspaceResponseDto` gains an `@Expose() activeEnvironmentId: string | null`; the
`implements Workspace` clause forces it or the build fails, which is the point.

It rides beside `role`, which the DTO already documents as *"not a column on `workspaces`"* — the
same kind of field, joined from the same table.

### Write path

`PUT /api/v1/workspaces/:id/active-environment`, body `{ environmentId: string | null }`, returning
`WorkspaceResponseDto`. **`PUT`, not `PATCH`**: a total assignment of a single-valued preference in
which `null` is a meaningful value rather than an omission.

In `WorkspacesService.setActiveEnvironment(userId, workspaceId, environmentId)`:

1. If non-null, confirm the environment belongs to *this* workspace in raw SQL —
   `SELECT 1 FROM "environments" WHERE "id" = $1 AND "workspaceId" = $2`. Precedent:
   `RequestsService.assertFolderInCollection`, which reaches `folders` in raw SQL rather than
   importing `CollectionsModule`. **Nothing imports `WorkspacesModule` and `WorkspacesModule` gains
   no imports.** A miss is a `NotFoundException` naming the environment.
2. `UPDATE "workspace_members" SET "activeEnvironmentId" = $1 WHERE "workspaceId" = $2 AND
   "userId" = $3 AND "role" = ANY($4)` with **`READ_ROLES`** — it is the caller's own preference row
   and a VIEWER is entitled to one. `affected === 0` → `explainDenial(…, WORKSPACE_SCOPE, …)`.
3. Return `findOne(userId, workspaceId)`.

⚠️ **This scoped `UPDATE` is keyed on `("workspaceId","userId")`, not on a row id** — an unusual
shape for this codebase. Copying the `"id" = :id` spelling from the other services would rewrite
*every member's* preference in the workspace.

---

## 7. Frontend

### 7.1 New tags

[baseApi.ts](frontend/src/app/baseApi.ts):
`tagTypes: ['Session','Me','Workspace','Tree','Request','Environment','Execution']`. Both now have
read endpoints, which is the standing rule for when a tag may exist — and the comment in that file
currently states the `Environment` tag is deliberately absent, so it must be updated too.

### 7.2 `frontend/src/features/environments/`

| File | What |
|---|---|
| `environmentsApi.ts` | `getEnvironments(workspaceId)`, `createEnvironment`, `updateEnvironment`, `deleteEnvironment`, `setActiveEnvironment` |
| `EnvironmentPicker.tsx` | a `Select` in `AppHeader`, beside `WorkspaceSwitcher` |
| `EnvironmentsDialog.tsx` | a `Dialog` — the list, with New / Rename / Delete driven by `PromptDialog` / `ConfirmDialog` |
| `VariableEditor.tsx` | the variables grid: key, value, enabled, `secret` |

- ⚠️ **`Select` reserves `''`.** "No environment" needs a real sentinel (`'__none__'`) mapped to
  `null` at the boundary, and `value` must be `activeEnvironmentId ?? '__none__'`. Passing `''`
  renders a blank trigger with no placeholder.
- `setActiveEnvironment` patches the `getWorkspaces` cache entry optimistically via
  `updateQueryData` — the `treePatch` doctrine; an invalidation would refetch the whole workspace
  list to change one field. Roll back with `invalidatesTags: ['Workspace']` on error.
- `VariableEditor` is written fresh rather than widening `KeyValueEditor` with an optional fourth
  column. `KeyValueEditor` is mounted in the two hottest tabs in the app and `EnvironmentVariable`
  is a different type; the small duplication is the cheaper trade. Flag it so it reads as a
  decision, not an omission.
- ⚠️ A `secret` variable renders `type="password"` — **cosmetic**, exactly as in `AuthTab`. Carry
  the same note.

### 7.3 Send

[RequestUrlBar.tsx](frontend/src/features/requests/RequestUrlBar.tsx): **replace the entire header
comment.** It currently reads *"⚠️ There is no Send button… Do not 'helpfully' add it."* — now false,
and precisely the sort of stale standing instruction that gets obeyed. The replacement states what
Send does (interpolates, resolves and screens, pins, follows redirects manually, caps size and time)
and what it deliberately does not (run scripts, keep cookies, stream).

Send goes to the **left** of Save and takes `bg-accent`; Save steps down to a secondary style. Send
becomes the primary action of the bar. Enabled whenever the URL is non-blank — ⚠️ **not gated on
`isDirty`**, and it **sends the draft**: with no autosave, gating Send on a clean draft makes the
pane feel broken. The mutation body carries `draft` when the draft differs, the server records
`usedDraft`, and the history row shows a "sent unsaved edits" marker.

`useSendRequest.ts` — a thin wrapper over the mutation holding the last `SendResult`, `isSending`,
and an `AbortController` so the user can cancel. ⚠️ Cancelling aborts the *client* subscription; the
server still finishes the upstream call. Say so in the file.

### 7.4 The response pane and the `min-h-0` chain

Today:

```
div.flex.h-full.flex-col                  ← pane root
  header (shrink-0)
  Tabs.Root.flex.min-h-0.flex-1.flex-col
    Tabs.List.shrink-0
    div.min-h-0.flex-1.overflow-auto
```

New — a vertical split below the header:

```
div.flex.h-full.flex-col
  header (shrink-0)
  div.flex.min-h-0.flex-1.flex-col          ← the split container
    Tabs.Root.flex.min-h-0.flex-1.flex-col  ← request half, internals unchanged
    ResponsePane                            ← shrink-0 basis-[45%] min-h-0 flex flex-col
                                              border-t border-line
      header.shrink-0    (status pill, duration, size, collapse toggle)
      div.min-h-0.flex-1.overflow-auto
```

⚠️ **`min-h-0` on every flex child in that chain, including the new split container.** A flex child
defaults to `min-height: auto`; one missing `min-h-0` and the whole editor scrolls instead of the
panes. `WorkbenchShell`'s `<main>` already scrolls, so the symptom is a double scrollbar — subtle
enough to ship.

Collapsed by default until the first send; collapsing leaves `h-9` (header only).

Contents: `Body` / `Headers` / `History` as a Radix `Tabs` — already a dependency, so no new
decision. Body gets a Pretty/Raw toggle reusing `BodyTab`'s
`JSON.stringify(JSON.parse(x), null, 2)`; **no editor library, no highlighting**, a plain `<pre>`
with `whitespace-pre-wrap break-all`. This is the dependency question `BodyTab.tsx` explicitly
deferred *to this slice*, and the answer is still no. A `base64` body renders *"Binary response —
image/png, 41.2 kB"* plus a Download button built from a `Blob` + `URL.createObjectURL` (revoked on
click) — never the base64 blob rendered as text. ⚠️ A `failure` outcome renders a `danger-soft` card
with the kind and message and **no status pill at all**: a `0` or `—` where a status code goes is
the exact confusion the two-outcome contract exists to prevent.

A `warnings` strip (`bg-warning-soft`) sits above the body whenever the result carries any.

### 7.5 New tokens

`frontend/src/features/requests/statusStyles.ts`, beside `methodStyles.ts`:

| Class | Tokens |
|---|---|
| 2xx | `bg-success-soft text-success-soft-fg` |
| 3xx | `bg-info-soft text-info-soft-fg` ← **new** |
| 4xx | `bg-warning-soft text-warning-soft-fg` |
| 5xx | `bg-danger-soft text-danger-soft-fg` |
| failure | `bg-danger-soft text-danger-soft-fg` |

The only new family is **`info`**, and only the *soft* pair — deliberately no solid `--info` /
`--on-info`, because nothing here is a filled info button and an unused token is one more thing to
retune per theme.

Three mandatory edits:

1. `--info-soft` / `--info-soft-fg` in **all five** blocks of [index.css](frontend/src/index.css)
   (`:root`, `dark`, `midnight`, `glass`, `paper`). ⚠️ The dark themes' soft fills are *translucent*
   so they tint the surface they land on — match the existing `--success-soft` spelling in each
   block rather than copying the light value down.
2. `--color-info-soft` / `--color-info-soft-fg` in the `@theme inline` block.
3. `['info-soft-fg on info-soft', '--info-soft-fg', '--info-soft', 4.5]` in `PAIRS` in
   [check-contrast.mjs](frontend/scripts/check-contrast.mjs). ⚠️ **A pair not in `PAIRS` is
   unchecked, not passing.** If `yarn contrast` fails, retune the tokens, never the threshold.

Every colour is a semantic token — never a Tailwind palette utility, which would pin the pill to
light mode forever and generate no warning.

### 7.6 History pane

`HistoryPane.tsx`: `useGetExecutionsQuery(requestId)` → rows of
`<method> <status pill> <duration> <relative time>`. Clicking one fires `GET /executions/:id` and
puts the response pane into a **"viewing a past run"** mode behind a `warning-soft` banner.
⚠️ Without that banner a user clicks history, sees a body, and believes their last Send returned it —
the same class of bug as the Scripts banner.

`send` invalidates `{ type: 'Execution', id: requestId }` and **nothing else** — in particular not
`Request`: no field of the saved request changed, and invalidating it would refetch the row, which
is exactly the kind of thing that re-seeds a draft mid-edit if `useRequestDraft`'s effect key were
ever loosened from `request?.id`.

---

## 8. New environment variables

All of these go into [env.validation.ts](backend/src/config/env.validation.ts) **and**
[backend/.env.example](backend/.env.example). ⚠️ Joi runs with `whitelist`, so a var missing from
the schema is invisible to `ConfigService` no matter what `.env` says — and one added to the schema
but not the example is invisible to the next person who copies it.

| Var | Default |
|---|---|
| `SEND_ALLOW_PRIVATE_NETWORK` | `false` |
| `SEND_CONNECT_TIMEOUT_MS` | `5000` |
| `SEND_TOTAL_TIMEOUT_MS` | `30000` |
| `SEND_MAX_REDIRECTS` | `5` |
| `SEND_MAX_RESPONSE_BYTES` | `5242880` |
| `SEND_MAX_REQUEST_BODY_BYTES` | `1048576` |
| `SEND_MAX_STORED_BODY_BYTES` | `262144` |
| `SEND_HISTORY_PER_REQUEST` | `50` |
| `SEND_HISTORY_RETENTION_DAYS` | `30` |
| `SEND_THROTTLE_BURST_TTL_MS` / `_LIMIT` | `60000` / `30` |
| `SEND_THROTTLE_SUSTAINED_TTL_MS` / `_LIMIT` | `3600000` / `600` |

---

## 9. Phasing

| Phase | Ships | Working after it |
|---|---|---|
| **0** | `execution.ts`, the `workspace.ts` field, the barrel, `./dev.sh contracts` | Both sides compile against the new shapes. Nothing runs. |
| **1** | `interpolate.ts`, `redact.ts` + specs | `yarn test` proves precedence, disabled-row shadowing, no-rescan, unresolved warnings, secret redaction. |
| **2** | `ssrf.ts`, `http-client.ts`, `send-options.ts` + specs; every `SEND_*` var | `yarn test` proves the address table (incl. mapped / NAT64 / 6to4 / decimal-IP), the pin, redirect re-screening, the size cap, the total deadline. Still no route. |
| **3** | `ExecutionModule`, `POST /requests/:id/send`, DTOs, the throttling-module extraction + send windows + `SendThrottlerGuard` | **curl sends a saved request.** An upstream 500 arrives as `200 { result: { outcome:'response', status:500 } }`; a blocked host as `200 { result: { outcome:'failure', kind:'blocked-address' } }`; a foreign request id as `404`. |
| **4** | `request_executions` entity + migration, `REQUEST_EXECUTION_SCOPE`, the three history routes, both retention policies | Every send is recorded; list/read/clear work; the cap holds at 50; the age sweep is tested and uncalled. |
| **5** | `AddActiveEnvironment` migration, the member entity field, `WORKSPACE_SELECT` + DTO, `PUT /workspaces/:id/active-environment` | `{{var}}` actually resolves. An API client can pick an environment and see it applied. |
| **6** | `features/environments/` — api, picker, dialog, variable editor; the `Environment` tag | A user creates an environment, edits variables and picks one in the header. Still no Send button. |
| **7** | Send button, `useSendRequest`, `ResponsePane`, `statusStyles.ts`, the `info` tokens + `PAIRS`, all doc updates | **The app sends.** |
| **8** | `HistoryPane`, the `Execution` tag, past-run mode | History browsable per request. |
| **9** *(optional)* | `SEND_MAX_CONCURRENT` in-flight semaphore, draggable splitter | Bounded concurrent sends; resizable pane. |

Phases 1–5 are backend-only and independently mergeable. Phase 6 is shippable ahead of 7 — an
environment editor is useful the moment the API resolves variables, which is the inversion of the
original "no UI without interpolation" argument, now satisfied.

---

## 10. Traps

- ⚠️ **An upstream failure is not our error.** DNS failure, refused connection, blocked address and
  a 500 from the target all return `200` with a `SendResult`. The error envelope means "we did not
  accept your send command". Reporting a timeout as a 504 makes history and the live pane need two
  renderers for one concept, and looks to a client exactly like our own API falling over.
- ⚠️ **Screening and connecting must be one act.** `resolveAndScreen` returns addresses and the
  connection is pinned via `lookup`. Screening a *hostname* and letting Node re-resolve it is a
  DNS-rebinding hole that passes every hand test, because the attack needs a second query to fire.
- ⚠️ **Every redirect hop re-screens and re-pins.** The first hop's clearance says nothing about the
  second's.
- ⚠️ **`::ffff:127.0.0.1`, `64:ff9b::7f00:1`, `2002:7f00:1::` and `http://2130706433/` all reach
  loopback.** A v4-only range table, or one that screens the raw input instead of `url.hostname`,
  misses all four.
- ⚠️ **Interpolation is a header-injection vector.** `{{token}}` can carry `\r\n`. Validate names and
  values *after* substitution and before the socket; do not lean on Node's `ERR_INVALID_CHAR` being
  the boundary.
- ⚠️ **A substituted value is never rescanned.** That is what makes `{{a}}` → `{{b}}` inert. Nested
  variables must be a deliberate, bounded, separately-specified change.
- ⚠️ **A disabled variable row is dropped before the merge, not after** — otherwise it shadows an
  enabled row of the same name in a lower-precedence scope and the variable silently stops resolving.
- ⚠️ **The response cap is on *decompressed* bytes.** We ask for `identity`; if the server compresses
  anyway, `zlib`'s `maxOutputLength` is what makes the cap real.
- ⚠️ **`buf.toString('utf8')` always "succeeds"** — it substitutes U+FFFD, so every JPEG becomes
  mojibake. Use `TextDecoder('utf-8', { fatal: true })` to decide text vs base64. Postgres also
  rejects ` `, so this is a 500 on the history insert, not just an ugly pane.
- ⚠️ **A failed history insert must not fail the send.** The request already left; a 500 here invites
  a retry that fires the upstream call twice.
- ⚠️ **`workspace_members.activeEnvironmentId` is `ON DELETE SET NULL`.** `CASCADE` deletes the
  *membership* — a user evicted from a workspace because an environment was tidied up, with no
  invite endpoint to repair it.
- ⚠️ **The active-environment `UPDATE` is keyed on `("workspaceId","userId")`, not on a row id.**
  Copying the `"id" = :id` shape from the other services rewrites every member's preference.
- ⚠️ **The environment must be confirmed to belong to the request's workspace**, not merely to be
  visible to the caller.
- ⚠️ **Tests override `SEND_OPTIONS`, never `process.env`.** `ConfigModule.forRoot()` reads and
  validates at decorator-evaluation time — the trap already recorded for `THROTTLER_OPTIONS`. The
  e2e suite talks to `127.0.0.1`, which the default policy blocks, so this is not theoretical.
- ⚠️ **jsonb defaults: SQL expression, no cast, spelled as Postgres normalizes.**
- ⚠️ **`min-h-0` on the new split container**, or the whole editor scrolls instead of the panes.
- ⚠️ **The new token pair must be in `PAIRS`.** Unlisted is unchecked, not passing.
- ⚠️ **Send sends the draft**, and history records `usedDraft` — otherwise the record claims
  something was sent that was never saved.
- ⚠️ **`request_executions` is a third plaintext-secrets store.** Name it in the README's warning.

## 11. Non-goals, each with its reason

- **Scripts are still not executed.** The banner stays, reworded. A sandbox is the security surface,
  not `RequestScripts`, and `node:vm` is not a security boundary — its own slice.
- **No cookie jar.** `set-cookie` is returned, never stored or replayed. A jar is per-user shared
  mutable state with its own tenancy question.
- **No streaming, SSE, WebSocket, GraphQL or gRPC.** Every response is buffered to a cap.
- **No proxy support, no client certificates, and no "disable TLS verification" toggle.** The last is
  the one most likely to be requested and the one that turns all the SSRF work into decoration.
- **No file uploads / multipart.** `RequestBody` has no binary mode; adding one is a storage question
  first.
- **No `@nestjs/schedule`.** `deleteExpiredExecutions()` is a hook point, like
  `deleteExpiredSessions()`.
- **No draggable splitter, no response search, no syntax highlighting.** A plain `<pre>` and a
  Pretty/Raw toggle, matching `BodyTab`.
- **No request cancellation on the server** beyond the total timeout.
- **Secrets are still plaintext.** Redaction covers stored history text only. The real fix remains a
  write-only secrets table with envelope encryption.
- **The active environment is per member, not per device** — deliberately the opposite of the theme
  preference, because an environment selects *which server you are about to hit* and that should
  follow you between machines.

---

## 12. Verify while building

1. `lookup` is honoured through `http.request` / `https.request` with `agent: false` — assert it in
   a unit test rather than trusting it.
2. Per-name `@SkipThrottle({ burst: true })` in `@nestjs/throttler@6.5`; fallback is a second guard
   subclass with its own window set.
3. `zlib` `maxOutputLength` overflow behaviour (throws `ERR_BUFFER_TOO_LARGE`) — confirm the code so
   it maps to truncation, not `unknown`.
4. `new URL()` normalization of decimal / octal / hex IPv4 hosts on this Node — pin whichever forms
   it does *not* normalize as explicit `ssrf.spec.ts` cases.
5. The `WorkspaceMemberEntity` → `EnvironmentEntity` relation for a TS circular-import warning.
6. Run `migration:generate` once against `request_executions`, diff it, discard the known
   `FK_folders_parent` / `FK_requests_folder` noise, and confirm nothing else appears.

---

## 13. Verification

```bash
./dev.sh contracts                 # after every packages/contracts edit — non-optional
cd backend && yarn migration:run
cd backend && yarn test            # interpolate, redact, ssrf, send-options, executions
cd backend && yarn test:e2e        # live Postgres; --runInBand
cd frontend && yarn contrast       # green on all five themes
cd frontend && yarn build && yarn lint
```

**`backend/test/send.e2e-spec.ts`**, against a local `http.createServer` fixture so nothing touches
the public internet, with `SEND_OPTIONS` overridden:

- 200 with a JSON body → `outcome: 'response'`, body and headers intact.
- Target returns 500 → **HTTP 200** from our API, `outcome: 'response'`, `status: 500`.
- Connection refused → **HTTP 200**, `outcome: 'failure'`, `kind: 'connect'`.
- `http://127.0.0.1/` with the policy on → `kind: 'blocked-address'`, **and the fixture records that
  no socket was opened**.
- A host that 302s to a loopback address → blocked on the hop.
- A cross-origin redirect → assert `Authorization` was **not** forwarded.
- A response over the cap → `bodyTruncated: true`, still `outcome: 'response'`.
- A header value containing `\r\n` from a variable → `kind: 'invalid-header'`.
- `{{baseUrl}}` with and without an active environment → resolved, vs. a warning naming `baseUrl`.
- Another user's request id → **404** (not 403 — no enumeration oracle), via `explainDenial`.
- An environment from a different workspace → 404.
- History caps at `SEND_HISTORY_PER_REQUEST` after N+1 sends.

**Manual, with `SEND_ALLOW_PRIVATE_NETWORK=true`:** `./dev.sh`, create an environment with
`baseUrl`, select it in the header, put `{{baseUrl}}/health` in a request, Send, and check the
response pane, the status pill in each of the five themes, and the history tab.

---

## 14. Documentation to update in the same change

- [RequestUrlBar.tsx](frontend/src/features/requests/RequestUrlBar.tsx) — replace the
  no-Send-button comment (§7.3).
- [ScriptsTab.tsx](frontend/src/features/requests/ScriptsTab.tsx) — the banner **stays** (scripts
  still never run) but its text *"sending requests is not built"* becomes false. New copy:
  **"Scripts are saved but never executed. Sending a request ignores both slots."** And the file
  comment's instruction *"Delete the banner in the same change that lands execution"* is now wrong
  and must be replaced with the opposite instruction.
- [CLAUDE.md](CLAUDE.md) — the *"No Send button, not even a disabled one"* bullet; the *Current
  state* paragraph listing sending and the environment UI as not-built; the `tagTypes` bullet
  claiming no `Environment` tag; a new **Send** section carrying §10's traps.
- [README.md](README.md) — the API table (four new routes plus the active-environment `PUT`); the
  *"Sending requests is out of scope here"* paragraph; the **Send** bullet under what's coming; and
  **`request_executions` added to the plaintext-secrets warning**.
- [backend/.env.example](backend/.env.example) — every new var, with the same commented rationale
  the `THROTTLE_*` block carries.
- `packages/contracts/src/environment.ts` — the "deferred until execution" prose.
