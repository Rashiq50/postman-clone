# Complete the authentication system (backend + frontend)

## Context

**This section describes the starting point, not the current state — all of it has since been
built. See *Progress* below.** At the time this plan was written, auth was half-built:
access-token generation and a global `JwtAuthGuard` worked, and nothing else did:

- `POST /api/v1/auth/login` is the **only** auth route. There is no refresh, logout, or
  session-management endpoint. `SessionsController` is an empty shell and `SessionsService`
  carries commented-out stubs.
- Login returns the refresh token **in the JSON body**. `AUTH_COOKIE_NAME` is Joi-validated at
  boot and `cookie-parser` is a dependency, but neither is wired — the httpOnly-cookie path is
  intended and unfinished.
- The **frontend has no auth at all**: no login screen, no router, and `baseApi` sends no
  `Authorization` header. Since the global guard protects `/tasks`, the task UI 401s against a
  running backend. The app is currently unusable end-to-end.

Outcome: a complete session system — login sets an httpOnly refresh cookie, refresh tokens
rotate on every use with reuse detection, logout and per-device revocation work, and the React
app logs in, silently restores its session on reload, and transparently refreshes on 401.

### Decisions already made

| Decision | Choice |
|---|---|
| Scope | Backend **and** frontend, one pass. No registration endpoint. |
| Refresh handling | Rotate every use, **with reuse detection** (replay ⇒ revoke the whole family) |
| Rotation schema | Separate `refresh_tokens` child table (see below), **not** lineage columns on `sessions` |
| Frontend token storage | In-memory Redux slice; silent refresh on boot. Never localStorage. |
| Endpoints | login, refresh, logout, logout-all, me, `GET /sessions`, `DELETE /sessions/:id` |
| Routing | `react-router` v7, router-only (no loaders/actions) |

**Why a child table:** `JwtAuthGuard` checks `isActive(payload.sid)` on every request. If rotation
replaced the session row, every access token would die the instant the client refreshed, `GET
/sessions` would become a ~2,880-row rotation log per 30-day login instead of a device list, and
`DELETE /sessions/:id` would be ambiguous. With a child table, **session = device/login (stable
`sid`)** and **refresh token = one rotation step**. The family *is* the session, so revoking it is
`UPDATE sessions SET revokedAt = now()`. The guard and its 15 passing tests are untouched.

---

## Progress — all three parts done

*Last updated 2026-08-19. Backend, frontend and contracts are complete and wired to each other.
The sections below are kept as the record of what was decided and why; where the implementation
departed from the letter of the plan, that is noted inline.*

**Part 1 — Contracts: done.** `packages/contracts/src/auth.ts` with all four interfaces exactly
as specified, exported from `index.ts` after `./api`, `dist/` synced into both apps.

**Part 2 — Backend: done.** Every item in §2.1–§2.12:

| § | Item | Notes |
|---|---|---|
| 2.1 | `common/duration.ts` + spec | Replaced the old parse that read `12h` as 12 days |
| 2.2 | `@types/cookie-parser@^1.4.9` | Needed for `req.cookies` on `@types/express@5` |
| 2.3 | Five env keys + the `SameSite=none` ⇒ `Secure` cross-check | Verified: boot is rejected |
| 2.4 | `RefreshTokenEntity`; `SessionEntity` gains `userAgent`/`ipAddress`/`refreshTokens`, loses `refreshTokenHash` | |
| 2.5 | `AddRefreshTokenRotation1786640000000` | `up` **and** `down` run clean against live Postgres |
| 2.6 | `refresh-cookie.ts` as plain functions | Set/clear symmetry pinned by spec |
| 2.7 | `UsersService.findById`/`findByEmail`, exported | `AuthService` no longer injects a repository |
| 2.8 | Full `SessionsService`, incl. `rotateWithin` and the session cap | Commit-then-throw, lock without join, grace anchored at first use |
| 2.9 | `AuthService` login/refresh/logout/logoutAll/me | `createToken` byte-identical; `expiresIn` decoded off the signed token |
| 2.10 | `AuthUserResponseDto`, `AuthResponseDto`, `SessionResponseDto`, `LoginDto` max lengths | The `@Type()` footgun is pinned by its own spec |
| 2.11 | Both controllers + `OriginCheckGuard` | Login is now 200 and carries no refresh token |
| 2.12 | Module wiring + `cookieParser()` | |

**Part 3 — Frontend: done**, unchanged by Part 2 — it was written against this API and needed no
edits once the backend caught up. `yarn lint` and `yarn build` both pass.

### Deviations from the letter of the plan

1. §3.1's SPA-fallback note went in the **root** `README.md`, since CLAUDE.md marks
   `frontend/README.md` as untouched boilerplate.
2. §3.6's `SessionsPage` uses conditional blocks rather than `TaskList`'s early returns, so the
   page header and "Sign out everywhere" stay mounted across all four states.
3. §2.3's cross-check `throw`s inside Joi's `.custom()` rather than calling `helpers.error` —
   same outcome, and the message survives verbatim.
4. The session-cap e2e lives in its own file, `test/session-cap.e2e-spec.ts`. It has to set
   `process.env.MAX_SESSIONS_PER_USER` before `AppModule` is first imported, because
   `ConfigModule.forRoot()` validates the environment exactly once per process.
5. §2.3's `REFRESH_ROTATION_GRACE_MS=0` trick was not needed for the reuse e2e; the test ages
   `usedAt` in SQL instead, which keeps it independent of the ambient config.
6. `@Transform(({ value }: { value: unknown }) => …)` in the response DTOs, including
   `TaskResponseDto`, which had the same untyped parameter. This removes six
   `no-unsafe-return` lint errors and keeps all three DTOs on one idiom.

### Environment reconciled

`backend/.env` had `AUTH_COOKIE_NAME=__Host-refresh` — a **real** `__Host-` prefix, which the
browser would have rejected outright against §2.6's `Path=/api/v1/auth`. Changed to
`.env.example`'s `pc_refresh_token`, and both the example file and CLAUDE.md now say explicitly
why a `__Host-` name must not be reintroduced. `REFRESH_TOKEN_EXPIRES_IN` was `7d` against the
example's `30d`; both now say `30d`, matching the prose in §2.8a/§3.8. `frontend/.env` still
does not exist, which is correct in dev.

### Verification actually run

- `cd backend && yarn test` — **134 passing**, 11 suites.
- `cd backend && yarn test:e2e` — **30 passing**, 3 suites, against live Postgres.
- `cd backend && yarn lint` — 7 errors remain, **all pre-existing** and none in auth or sessions
  code (`jwt-auth.guard.spec`, `all-exceptions.filter`, `health.controller.spec`,
  `tasks.service.spec`, `app.e2e-spec`).
- `cd frontend && yarn lint && yarn build` — both clean.
- `yarn migration:run`, `migration:revert`, `migration:run` — all three clean.
- Two traps were checked by deliberately breaking the implementation and confirming the tests
  caught it: throwing inside `rotate`'s transaction (the rollback trap, risk #1) and replacing
  `COALESCE("lastUsedAt", "createdAt")` with a bare `lastUsedAt` ordering. Both failed as
  designed, then passed again once reverted.

The manual browser checklist below (steps 1–11) has **not** been run — it needs a human at a
browser.

---

## Cross-cutting rules (from CLAUDE.md — binding)

- `packages/contracts` is **copied, not symlinked**. After any edit to `packages/contracts/src`,
  run `./dev.sh contracts` or both sides keep compiling against a stale `dist/`.
- Never a TS `enum` in contracts (frontend uses `erasableSyntaxOnly`).
- Never return an entity from a controller — `@Expose()`-only DTO via `excludeExtraneousValues`,
  keeping the `implements <ContractType>` clause so drift is a compile error. Lists return
  `{ data, meta }`.
- Signing/verify options live **only** in the `JwtModule.registerAsync` factory.
- Every new env var must be added to `env.validation.ts` — Joi runs with `whitelist`.
- Migrations only; `synchronize` is false.
- ~~**Match the file's indentation.** `auth/**` and `sessions/sessions.service.ts` are 4-space and
  not Prettier-clean; everything else is 2-space. Do not reformat.~~ **No longer applies:** a
  `yarn lint` run (which is `eslint --fix`) reformatted the whole backend on 2026-08-19, and the
  tree is now uniformly 2-space and Prettier-clean. **Every "(4-space)" label in §2.6, §2.8, §2.9
  and §2.11 below is stale — write new backend code 2-space.**

---

# Part 1 — Contracts

### `packages/contracts/src/auth.ts` (new)

```ts
export interface LoginInput { email: string; password: string; }

export interface AuthUser { id: string; email: string; name: string; createdAt: string; }

/** The refresh token never appears here — it travels only in the httpOnly cookie. */
export interface AuthResponse {
  accessToken: string;
  /** Seconds until `accessToken` expires, so a client can refresh proactively. */
  expiresIn: number;
  user: AuthUser;
}

/** One live login, as shown in a "your devices" list. */
export interface SessionSummary {
  id: string;
  /** True for the session that issued the access token making this request. */
  current: boolean;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}
```

**Login and refresh return the same `AuthResponse`, including `user`.** This is deliberate: without
`user` on refresh, every app boot costs an extra `GET /auth/me` round trip and the header flickers.

### `packages/contracts/src/index.ts`
Add `export * from './auth';` after `./api`. **Then run `./dev.sh contracts`.**

---

# Part 2 — Backend

## 2.1 `backend/src/common/duration.ts` (new, 2-space) + spec

Export `parseDuration(value: string): number` (ms) — regex `^(\d+)(ms|s|m|h|d)$`, unit table,
throw on mismatch. Replaces the current parse in `sessions.service.ts`:
`parseInt('12h'.replace('d','')) * 86400000` → **12 days**, silently.

Do **not** `import ms from 'ms'` — it is only present transitively via `jsonwebtoken`; a phantom
dependency that breaks on the next `@nestjs/jwt` bump.

## 2.2 Dev dependency

`cd backend && yarn add -D @types/cookie-parser@^1.4.9`. Pin ≥1.4.9 — earlier versions augment
`@types/express@4` and this repo is on v5. Without it, `req.cookies` does not exist on `Request`.

## 2.3 `backend/src/config/env.validation.ts` + `.env.example`

Add a pattern to the existing var (keep `.required()`), and four new keys:

```ts
REFRESH_TOKEN_EXPIRES_IN: Joi.string().pattern(/^\d+(ms|s|m|h|d)$/).required(),
COOKIE_SECURE: Joi.boolean().when('NODE_ENV', {
  is: 'production', then: Joi.boolean().default(true), otherwise: Joi.boolean().default(false),
}),
COOKIE_SAME_SITE: Joi.string().valid('lax', 'strict', 'none').default('lax'),
COOKIE_DOMAIN: Joi.string().hostname().allow('').default(''),
REFRESH_ROTATION_GRACE_MS: Joi.number().integer().min(0).default(10000),
// Concurrent live sessions per user. A developer legitimately has desktop app +
// browser + dev browser + private window + a second machine, so this is set well
// above "a few" — it exists to bound abuse, not to police normal use. See §2.8a.
MAX_SESSIONS_PER_USER: Joi.number().integer().min(1).default(10),
```

Add an object-level `.custom(...)` cross-check: `COOKIE_SAME_SITE=none` without `COOKIE_SECURE`
must fail at boot. Browsers silently drop such a cookie, producing a login that appears to work
and then never authenticates.

## 2.4 Entities

### `backend/src/sessions/entities/refresh-token.entity.ts` (new, 2-space)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `sessionId` | uuid NOT NULL, FK → `sessions(id)` CASCADE | `@ManyToOne` + `@RelationId`, mirroring `SessionEntity.user` |
| `tokenHash` | `varchar(64)` NOT NULL **UNIQUE** | sha256 hex; the unique index is also the lookup path |
| `expiresAt` | timestamptz | `= session.expiresAt` (absolute cap) |
| `usedAt` | timestamptz NULL | **this one column is the whole reuse detector** |
| `revokedAt` | timestamptz NULL | killed without being spent |
| `replacedByTokenId` | uuid NULL, self-FK SET NULL | forensics: walk forward from a compromised token |
| `createdAt` | timestamptz DEFAULT now() | |

No `@UpdateDateColumn` — append-only audit record. Comment that this departs from `SessionEntity`.
Declare indexes with explicit names on the class (`UQ_refresh_tokens_tokenHash`,
`IDX_refresh_tokens_sessionId`) so a future `migration:generate` doesn't churn.

### `backend/src/sessions/entities/session.entity.ts` (edit)

- **Remove** `refreshTokenHash`.
- **Add** `userAgent: string | null` (`varchar(512)`), `ipAddress: string | null` (`varchar(45)`, fits IPv6).
- **Add** `@OneToMany(() => RefreshTokenEntity, (t) => t.session) refreshTokens`.
- **Add** `@Index('IDX_sessions_userId')` on the `user` relation. The index exists in the DB but not
  in entity metadata, so `migration:generate` would currently emit a spurious `DROP INDEX`.

## 2.5 Migration — `AddRefreshTokenRotation`

Use **`yarn migration:create`**, not `generate` (see the spurious DROP INDEX above, and `generate`
cannot produce the data step). Timestamp > `1786631900000`. Match the hand-written camelCase-quoted
SQL style of `AddUsersAndSessions`.

`up()`: create `refresh_tokens` → `IDX_refresh_tokens_sessionId` → both FKs → add
`sessions.userAgent`/`ipAddress` → **carry live sessions forward** (the hash algorithm is unchanged,
so this is exact, and nobody gets logged out):

```sql
INSERT INTO "refresh_tokens" ("sessionId", "tokenHash", "expiresAt")
SELECT "id", "refreshTokenHash", "expiresAt" FROM "sessions"
WHERE "revokedAt" IS NULL AND "expiresAt" > now()
```

→ then `CREATE UNIQUE INDEX "UQ_refresh_tokens_tokenHash"` (**after** the insert, so a duplicate
fails loudly) → `DROP COLUMN "sessions"."refreshTokenHash"`.

`down()`: re-add `refreshTokenHash` with `DEFAULT ''`, backfill via `DISTINCT ON ("sessionId")` of
the newest unspent/unrevoked token, drop the default, drop `ipAddress`/`userAgent`, drop
`refresh_tokens`. Sessions whose token was already spent get `''` (unusable) — comment that a
lossless down is not achievable here.

## 2.6 `backend/src/auth/refresh-cookie.ts` (new, 4-space)

**Plain exported functions, not an `@Injectable()`.** `SessionsController` needs `clear` too, and a
provider would force `SessionsModule → AuthModule`, which already imports `SessionsModule`. Plain
functions are a TS import with no DI edge.

```ts
export function refreshCookieOptions(config: ConfigService): CookieOptions
export function setRefreshCookie(res, config, token: string, expiresAt: Date): void
export function clearRefreshCookie(res, config): void
export function readRefreshCookie(req, config): string | undefined
```

| Option | Value |
|---|---|
| `httpOnly` | `true`, always |
| `secure` | `COOKIE_SECURE` |
| `sameSite` | `COOKIE_SAME_SITE` (default `lax`) |
| `path` | `` `/${API_PREFIX}/v${API_VERSION}/auth` `` — built from the constants, not a literal |
| `domain` | `COOKIE_DOMAIN \|\| undefined` |
| `maxAge` | `expiresAt.getTime() - Date.now()` |

`clearRefreshCookie` **must** spread the identical options minus `maxAge`. One mismatched
character and `clearCookie` leaves the cookie in place and logout silently doesn't work — this is
the single most common bug in this feature and the entire justification for the file.

**Path `/api/v1/auth`** keeps the long-lived credential off `/api/v1/tasks` — out of task-endpoint
access logs and out of the blast radius of a bug on a hot path. Trade-off: it rules out the
`__Host-` cookie prefix (which requires `Path=/`). Acceptable — `__Host-` guards against cookie
shadowing from untrusted sibling subdomains, which this deployment does not have. Comment it.

## 2.7 `backend/src/users/` — fill in `UsersService`

`findById(id): Promise<UserEntity | null>`, `findByEmail(email): Promise<UserEntity | null>` (both
return `null`, never throw). Add `exports: [UsersService]` to `users.module.ts`.
`AuthService` stops injecting `Repository<UserEntity>`. The `DUMMY_PASSWORD_HASH` timing defence
**stays in `AuthService`** — it is an authentication concern, and moving it would hide it.

## 2.8 `backend/src/sessions/sessions.service.ts` (4-space, do not reformat)

Inject both repositories + `ConfigService`. Resolve config **once in the constructor**
(`refreshTtlMs = parseDuration(...)`, `rotationGraceMs`) so a bad value fails at boot, not on the
first login.

```ts
export interface SessionContext { userAgent?: string | null; ipAddress?: string | null; }
export interface IssuedRefresh { session: SessionEntity; refreshToken: string; expiresAt: Date; }

create(userId, context?): Promise<IssuedRefresh>          // one transaction, writes both rows
isActive(sessionId): Promise<boolean>                     // UNCHANGED — do not touch
findByRefreshToken(rawToken): Promise<RefreshTokenEntity | null>
rotate(rawToken): Promise<IssuedRefresh>
revoke(sessionId): Promise<void>
revokeOwned(userId, sessionId): Promise<void>             // guarded UPDATE; affected===0 → NotFound
revokeByRefreshToken(rawToken): Promise<void>             // idempotent, for logout
revokeAllForUser(userId, opts?: { exceptSessionId?: string }): Promise<number>
findActiveForUser(userId, query: PaginationQueryDto): Promise<Paginated<SessionEntity>>
deleteExpiredSessions(): Promise<number>
```

`rotate(rawToken)` drops the stub's `(sessionId, oldToken)` shape — the session is derivable from
the token, and a caller-supplied id is a mismatch bug waiting to happen.

### 2.8a Session cap — `MAX_SESSIONS_PER_USER`

Enforced inside `create()`'s existing transaction, **after** the insert, as `private
enforceSessionCap(manager, userId): Promise<number>`. Create-then-trim, not trim-then-create: the
count is then exact, and the session just issued is by definition the most recent, so it can never
be the one revoked.

**Revoke, never delete** — the row stays queryable for audit, and physical removal is already the
job of `deleteExpiredSessions()` when `expiresAt` passes. Two-stage lifecycle: revoked now,
collected in 30 days.

One set-based statement, which is what makes this safe:

```sql
UPDATE "sessions" SET "revokedAt" = now()
WHERE "id" IN (
  SELECT "id" FROM "sessions"
  WHERE "userId" = $1 AND "revokedAt" IS NULL AND "expiresAt" > now()
  ORDER BY COALESCE("lastUsedAt", "createdAt") DESC
  OFFSET $2   -- MAX_SESSIONS_PER_USER
)
```

Three things that statement buys, each of which a read-then-write loop would get wrong:

- **No race.** Two simultaneous logins would both read `count === MAX`, both revoke one, both
  insert, and land at `MAX + 1`. As a single statement inside the transaction there is no
  read-then-write window; concurrent logins converge.
- **Self-healing.** It revokes *everything* past the cap, not just one row, so lowering
  `MAX_SESSIONS_PER_USER` in `.env` trims users down on their next login instead of leaving them
  permanently over the limit.
- **`COALESCE(lastUsedAt, createdAt)` is load-bearing.** `lastUsedAt` is `null` until a session's
  first rotation (§2.8), and Postgres sorts `NULL` first under `DESC` — so ordering on the bare
  column would rank every never-refreshed session as the *most* recently active and preferentially
  evict the ones actually in use. `COALESCE` is the honest "last activity" key.

Revoking the session row alone is sufficient; the children need no update, because both
`isActive()` and `rotate()` step 5 already gate on the parent session. That keeps this to one
statement.

**On "oldest inactive" — I read `inactive` as relative, not absolute.** An idle-threshold policy
("revoke sessions unused for > N days") is not a cap: a user with `MAX` genuinely-active sessions
has nothing to trim, and the login either has to exceed the cap or fail. So the policy is strictly
*oldest by last activity*, and it always makes room. Say so where the constant is defined, because
"inactive" invites the other reading.

**Consequence to accept:** the evicted device stops working silently — its next request 401s, its
refresh finds a revoked session, and it lands on `/login` with the same generic message as every
other refresh failure (§2.8, deliberate). That is already the documented convergence path in §3.8.
At a cap of 10 a real user will effectively never see it; credential stuffing will.

This also bounds — but does not replace — the orphaned-session problem in §3.8. The cap is the
backstop; revoking the presented cookie's session on login (§2.9) is the precise fix. Both are
in scope.

**Expiry is absolute, never sliding.** `sessions.expiresAt` is set at login and never extended;
each child token inherits it. Sliding expiry means a stolen token grants indefinite access, which
is exactly what reuse detection exists to bound.

### `rotate` — the state machine

Split into `private rotateWithin(manager: EntityManager, rawToken): Promise<RotateOutcome>` wrapped
by a public `rotate` that opens the transaction. That split is what makes it unit-testable against a
fake `EntityManager` instead of a live database.

Inside the transaction, on `tokenHash = sha256(rawToken)`:

1. Lock **the token row alone**, no join:
   `createQueryBuilder(RefreshTokenEntity,'t').setLock('pessimistic_write').where('t."tokenHash" = :h')`.
   Then load the session separately. ⚠️ **Never combine `lock` with `relations`/`leftJoin`** —
   Postgres rejects `FOR UPDATE` against the nullable side of an outer join and TypeORM's
   `findOne({ lock, relations })` throws outright.
2. No row → `invalid`, revoke nothing (a random guess must not be able to kill a session).
3. `revokedAt` set → `invalid`, revoke nothing (family already dead).
4. `usedAt` set:
   - within `REFRESH_ROTATION_GRACE_MS` → **benign race** (two tabs). Mint another child off the
     same parent, but **leave the old row untouched — do not re-stamp `usedAt` and do not
     overwrite `replacedByTokenId`.** The grace window must stay anchored at the *first* use:
     re-stamping `usedAt` here would slide the window forward on every replay, so an attacker
     replaying a stolen token every `grace − ε` would read as "benign" forever and reuse
     detection would never fire. (Leaving `replacedByTokenId` pointing at the first child also
     keeps the forensic chain intact.) Two live siblings briefly exist; both belong to the same
     revocable session, so this is harmless.
   - otherwise → **`reuse`**.
5. Session revoked/expired, or token expired → `invalid`, revoke nothing (expiry is not theft).
6. Happy path (`usedAt` null): set `usedAt = now` on the old row; insert a new row (fresh 32
   bytes, `expiresAt = session.expiresAt`); set `old.replacedByTokenId`; `UPDATE sessions SET
   lastUsedAt = now()`.

### ⚠️ The rollback trap — put this in a code comment

On reuse you must revoke the family **and** reject the request. If you `throw` from inside
`transaction()`, TypeORM rolls back **including the revocation you just wrote** — the detector
becomes a no-op that looks correct in casual testing. Return a discriminated outcome, let the
transaction commit, then throw outside it:

```ts
type RotateOutcome =
  | { kind: 'rotated'; session; refreshToken; expiresAt }
  | { kind: 'reuse'; sessionId; userId }
  | { kind: 'invalid' };
```

**All four failure modes throw the same message** — `ApiException.unauthenticated('Invalid refresh
token')`. The client's remedy is identical (log in again), and telling an attacker their replay was
detected is free intel. Detail goes to `Logger.warn`, matching the collapse-to-one-message reasoning
already in `jwt-auth.guard.ts`.

**Concurrency: lock *and* grace, together.** The lock alone turns a benign double-tab race into a
forced logout (the loser wakes, sees `usedAt`, nukes the family). Grace alone leaves the state
machine non-deterministic. Together: the lock serialises, the grace tells the loser "you're a tab,
not a thief."

### Other methods
- `revokeOwned` — `NotFoundException` on `affected === 0`, **not** `Forbidden`; a 403 confirms the id
  exists and enables enumeration. Same reasoning as `TasksService.findOne`.
- `revokeByRefreshToken` — revokes the token's **session** (killing all children). Never trips reuse
  detection: logout revokes, it does not rotate. Unknown/spent token → no-op, no throw.
- `findActiveForUser` — `findAndCount` + the existing `paginated()` helper, ordered
  `lastUsedAt DESC, createdAt DESC`.
- `deleteExpiredSessions` — implement and unit-test, leave **uncalled**. `@nestjs/schedule` is not a
  dependency and adding it is out of scope. Comment it as a cron hook point.
- `lastUsedAt` is written in exactly one place: `rotate`'s happy path. Not per-request — that would
  turn the guard's one indexed PK read into a read + write on every API call.

## 2.9 `backend/src/auth/auth.service.ts` (4-space)

Keep `DUMMY_PASSWORD_HASH` and `createToken` **byte-identical** — five spec cases pin `createToken`.

```ts
login(email, password, context?, presentedRefreshToken?): Promise<IssuedAuth & { user: UserEntity }>
refresh(rawRefreshToken: string | undefined): Promise<IssuedAuth & { user: UserEntity }>
logout(rawRefreshToken: string | undefined): Promise<void>   // resolves on undefined, never throws
logoutAll(userId): Promise<void>
me(userId): Promise<UserEntity>                              // null → Unauthorized, not NotFound
createToken(userId, sessionId): string                       // unchanged
```

**`login` takes the refresh cookie the browser presented, and revokes its session** — after the
password check succeeds and before `sessionsService.create`, call
`sessionsService.revokeByRefreshToken(presentedRefreshToken)` when the cookie is present. This is
the same-browser orphan fix from §3.8, **in scope, not optional**: the cookie slot is about to be
overwritten, so the session behind it would otherwise sit unrevoked for its full lifetime as a
ghost device. It is precise — the only way to present that cookie is to *be* the browser being
overwritten, so other devices are untouched — and safe, because `revokeByRefreshToken` is
idempotent and never throws, so a stale or foreign cookie cannot break login. Revoke only after
the password check: an unauthenticated `POST /auth/login` must not be able to kill a session.

The service returns the **raw** refresh token to the controller; cookies are HTTP plumbing and
keeping them out preserves the seam that makes `auth.service.spec.ts` meaningful.

`expiresIn` is derived from the token just signed — `const { exp, iat } = jwtService.decode(...)` —
so it cannot drift from the `JwtModule` factory. Re-reading `JWT_ACCESS_EXPIRES_IN` here would be a
second copy of a signing parameter, which CLAUDE.md forbids.

## 2.10 Response DTOs

All `@Expose()`-only, `plainToInstance(..., { excludeExtraneousValues: true })`, with the
`implements` clause.

- `auth/dto/auth-user.dto.ts` — `AuthUserResponseDto implements AuthUser` (copy `TaskResponseDto`'s
  `@Transform` ISO conversion).
- `auth/dto/auth-response.dto.ts` — `AuthResponseDto implements AuthResponse`, with
  ```ts
  @Expose() @Type(() => AuthUserResponseDto) user: AuthUserResponseDto;
  ```
  ⚠️ **The `@Type()` is load-bearing.** Under `excludeExtraneousValues`, a nested `@Expose()`d
  property without `@Type` is not transformed through the child class's rules — you get a stripped
  or an untransformed-passthrough object, and the whole point of the boundary is that
  `passwordHash` can never reach the wire. Pin it with a unit assertion.
- `sessions/dto/session-response.dto.ts` — `SessionResponseDto implements SessionSummary`, with
  `static from(session, currentSessionId)` computing `current`, and `fromMany`.
- `auth/dto/login-dto.ts` — add `@MaxLength(320)` / `@MaxLength(256)` so a multi-megabyte body
  can't be fed to Argon2.

## 2.11 Controllers

### `backend/src/auth/auth.controller.ts` (4-space)
Change `@Controller('auth')` → `@Controller({ path: 'auth', version: API_VERSION })`. Identical URL
(`defaultVersion` is `'1'`), brings it in line with the other controllers.

| Route | Decorators | Params | Returns |
|---|---|---|---|
| `POST login` | `@Public()` `@HttpCode(OK)` | `@Body() LoginDto`, `@Req()`, `@Res({ passthrough: true })` | `AuthResponseDto` |
| `POST refresh` | `@Public()` `@HttpCode(OK)` | `@Req()`, `@Res({ passthrough: true })` | `AuthResponseDto` |
| `POST logout` | `@Public()` `@HttpCode(NO_CONTENT)` | `@Req()`, `@Res({ passthrough: true })` | `void` |
| `POST logout-all` | *protected* `@HttpCode(NO_CONTENT)` | `@CurrentUser()`, `@Res({ passthrough: true })` | `void` |
| `GET me` | *protected* | `@CurrentUser()` | `AuthUserResponseDto` |

- **`passthrough: true` is mandatory** — without it Nest stops serialising the return value and the
  handler hangs after setting the cookie.
- **Login no longer returns `refreshToken` in the body.** Verified: nothing in the repo consumes it.
  Login also becomes 201 → 200; nothing asserts 201.
- `login` collects `{ userAgent: req.header('user-agent')?.slice(0, 512) ?? null, ipAddress: req.ip ?? null }`
  and passes `readRefreshCookie(req, config)` as `presentedRefreshToken` (§2.9's same-browser
  session revocation).
  ⚠️ `req.ip` is the **proxy's** address unless `trust proxy` is set, which `main.ts` does not do.
  Comment it; wiring it needs `NestExpressApplication` and is a separate deployment change.
- `logout` is `@Public()` and reads the cookie, never `@CurrentUser()` — a protected logout 401s
  exactly when a user most wants it to work (a tab left open past 15 minutes). Always 204, whether
  the cookie was valid, spent, or absent. `logout-all` stays **protected**: it is global and
  destructive, so it demands a live access token.
- `refresh` and `logout` are `@Public()`, so `request.user` is undefined — `@CurrentUser()` must not
  appear in either.
- Every route that ends a session calls `clearRefreshCookie(res, config)`.

### `backend/src/sessions/sessions.controller.ts` (2-space)

| Route | Decorators | Params |
|---|---|---|
| `GET /sessions` | *protected* | `@CurrentUser()`, `@Query() PaginationQueryDto` → `Paginated<SessionResponseDto>` |
| `DELETE /sessions/:id` | *protected* `@HttpCode(NO_CONTENT)` | `@CurrentUser()`, `@Param('id', ParseUUIDPipe)`, `@Res({ passthrough: true })` |

Paginate the list — the `{ data, meta }` invariant is absolute, `paginated()` already exists, and it
costs two lines. Follow `TasksController.findAll`'s shape. `DELETE` calls `revokeOwned(user.userId,
id)` and clears the cookie when `id === user.sessionId`.

### CSRF on `POST /auth/refresh`

The route must be `@Public()` (the access token is expired by definition), so its only credential is
an automatically-attached cookie — the textbook CSRF shape.

**Impact:** CORS allows exactly one origin, so an attacker cannot *read* the response. The realistic
damage is a forced rotation — denial of service, not theft.

**`SameSite=Lax` closes it**, because refresh is POST-only and unreachable by top-level navigation.
`Strict` buys nothing extra (it only additionally blocks top-level GET, and there is no GET) while
costing graceful behaviour for a future OAuth callback or magic link.

**Also add a small `OriginCheckGuard`** (~8 lines, applied to the public state-changing auth routes):
reject when `Origin` is present and ≠ `CORS_ORIGIN`. This costs almost nothing and means the
feature's security does not silently depend on `COOKIE_SAME_SITE` never being set to `none` for a
cross-site production deploy. Do **not** rely on `Content-Type: application/json` as the barrier — a
cross-site form can POST `x-www-form-urlencoded`, which is a simple request and is not preflighted.

*Out of scope, worth a README follow-up line:* `RATE_LIMITED` exists in `ApiErrorCode` and nothing
produces it; login and refresh are both brute-forceable. `@nestjs/throttler` is not a dependency.

## 2.12 Module wiring

### `backend/src/auth/auth.module.ts`
```ts
imports: [UsersModule, SessionsModule, JwtModule.registerAsync({ /* unchanged */ })],
providers: [AuthService, JwtAuthGuard, { provide: APP_GUARD, useExisting: JwtAuthGuard }],
```
Drop `TypeOrmModule.forFeature([UserEntity, SessionEntity])` and **drop `SessionsService` from
`providers` — that line is the actual bug.** Nest caches module instances, so importing
`SessionsModule` in two places yields one instance; re-providing the *class* here is what creates the
second. Adding the import without deleting the provider fixes nothing. Leave the `JwtModule` factory
untouched.

### `backend/src/sessions/sessions.module.ts`
`forFeature([SessionEntity, RefreshTokenEntity])`. **Do not add `imports: [AuthModule]`** — that
creates a cycle and is unnecessary; the guard is a global `APP_GUARD`. (This is also why §2.6 is
plain functions.)

### `backend/src/configure-app.ts`
```ts
app.use(cookieParser());
app.enableCors({ origin: CORS_ORIGIN, credentials: true, exposedHeaders: ['x-request-id'] });
```
No cookie-parser secret — the token is 256 bits of entropy verified against a server-side hash, so
signing adds nothing. Because `configureApp` is shared with e2e, the tests get production cookie
behaviour for free.

---

# Part 3 — Frontend

## 3.1 Dependency
`cd frontend && yarn add react-router@^7` — the package is `react-router`; v7 folded in
`react-router-dom`. **Do not install `react-router-dom`.** No `@types` needed.

Use it as a **router only** — no `loader`/`action`/`fetcher`. Loaders would need the access token
from Redux, forcing a `store` import into route modules. Data stays in RTK Query hooks, matching
`TaskList`/`TaskForm`. Production needs an SPA fallback (all paths → `index.html`); Vite dev and
`vite preview` do this automatically — note it in `frontend/README.md`.

## 3.2 `src/features/auth/authSlice.ts` (new)

```ts
type AuthState = {
  /** Memory only. Never written to storage; a reload starts at null. */
  accessToken: string | null
  user: AuthUser | null
  /** False until the boot-time silent refresh has settled, either way. */
  bootstrapped: boolean
}
```

Actions `credentialsReceived`, `userLoaded`, `loggedOut`, `bootstrapFinished`; selectors
`selectAccessToken`, `selectCurrentUser`, `selectIsAuthenticated`, `selectIsBootstrapped`.

No `status` field — per-request loading already lives in RTK Query's hooks; duplicating it creates
two sources of truth. `bootstrapped` is the one flag RTKQ cannot give you, because the boot refresh
is dispatched outside React. `loggedOut()` leaves `bootstrapped` **true** so signing out does not
re-show the splash.

**Memory-only is achieved by doing nothing** — no redux-persist, no storage writes, no persistence
middleware. The thing to police in review is that nobody "helpfully" adds one later.

**Do not add a module-level token mirror.** Use RTK Query's `prepareHeaders: (headers, { getState })`.
The apparent cycle is type-only and therefore absent at runtime: `baseApi.ts` imports `RootState`
with `import type`, and `verbatimModuleSyntax` guarantees `import type` emits no import statement.
Runtime graph is `main → store → baseApi → authSlice`. Acyclic. A mirror would be strictly worse —
two places to clear on logout, drifting the moment someone forgets one.

## 3.3 `src/app/baseApi.ts` — **move it here** from `features/tasks/tasksApi.ts`

The invariant CLAUDE.md protects is *"one `createApi`"*, not the filename. Leaving it in
`tasksApi.ts` would make `features/auth/authApi.ts` import from `features/tasks/` for
infrastructure, and make `features/tasks` depend on `features/auth` to compile (it would need
`loggedOut`). `src/app/` already holds cross-cutting wiring (`store.ts`, `hooks.ts`).
**This requires updating CLAUDE.md (~L98-100) and README.md (Frontend section, ~L186) in the same change.**

Contents: `rawBaseQuery` (`fetchBaseQuery` + `credentials: 'include'` + `prepareHeaders`), then
`baseQueryWithReauth`, then `createApi({ baseQuery: baseQueryWithReauth, tagTypes: ['Task','Session','Me'] })`.

`credentials: 'include'` unconditionally: a no-op in dev (Vite proxy makes it same-origin) and
**mandatory** in a cross-origin prod deploy, so don't branch on environment.

```ts
/** Endpoints whose 401 *is* the answer, not a symptom of a stale token. */
const NEVER_REAUTH = new Set(['login', 'refresh', 'logout', 'logoutAll'])

function isUnauthenticated(error: FetchBaseQueryError | undefined) {
  return error?.status === 401 && toApiError(error)?.code === 'UNAUTHENTICATED'
}

/**
 * The refresh currently in flight, shared by every request that 401s while it
 * runs. Without it a page with three queries fires three refreshes, and since
 * the backend rotates the refresh token the last two present one it already
 * burned — turning an expired access token into a forced logout.
 */
let refreshInFlight: Promise<string | null> | null = null

function refreshOnce(api, extraOptions) {
  refreshInFlight ??= runRefresh(api, extraOptions).finally(() => { refreshInFlight = null })
  return refreshInFlight
}

export const baseQueryWithReauth: BaseQueryFn<...> = async (args, api, extraOptions) => {
  const result = await rawBaseQuery(args, api, extraOptions)
  if (!isUnauthenticated(result.error) || NEVER_REAUTH.has(api.endpoint)) return result

  // Snapshot the token this request failed under. If it changed while the
  // refresh was in flight, a login landed behind us and our failure is stale —
  // dropping the loggedOut() on the floor is the entire point. See §3.8.
  const staleToken = (api.getState() as RootState).auth.accessToken

  const accessToken = await refreshOnce(api, extraOptions)
  if (!accessToken) {
    if ((api.getState() as RootState).auth.accessToken === staleToken) {
      // The only place the app decides a session is over.
      api.dispatch(loggedOut())
    }
    return result
  }
  // prepareHeaders reads getState() again, so the retry carries the new token.
  return rawBaseQuery(args, api, extraOptions)
}
```

`runRefresh` calls `rawBaseQuery({ url: 'auth/refresh', method: 'POST' }, ...)` **raw**, then
dispatches `credentialsReceived`. Dispatching `authApi.endpoints.refresh.initiate()` here would make
`app/baseApi → features/auth/authApi → app/baseApi` a genuine runtime cycle where `baseApi` is
`undefined` at `injectEndpoints` time. Three duplicated lines is the cheaper trade — **comment it or
someone will "fix" it into a cycle.**

Gate on `api.endpoint` (the endpoint *name*), not URL sniffing — immune to `args` being a string vs
a `FetchArgs`, and unbreakable by a URL rewrite.

Two deliberate behaviours to state in review: (a) a request that *starts* mid-refresh may kick off a
second refresh after the singleton clears — correct, one wasted round trip, cheaper than gating the
hot path; (b) the retry happens exactly once, and its failure is not re-entered, so no loop is possible.

## 3.4 `src/features/auth/authApi.ts` + `src/features/sessions/sessionsApi.ts` (new)

Both via `baseApi.injectEndpoints`. `authApi`: `login`, `refresh`, `logout`, `logoutAll` (mutations),
`me` (query, `providesTags: ['Me']`). `sessionsApi`: `listSessions` (per-id + `LIST` tags, matching
`getTasks`), `revokeSession` (`invalidatesTags: [{ type: 'Session', id: 'LIST' }]`).

`refresh` exists as an endpoint **as well as** the raw call in §3.3 — the boot sequence needs to
trigger a refresh from outside a failing request, and having it named is what makes
`NEVER_REAUTH.has('refresh')` protect the boot call from recursing.

**Feed the slice with `onQueryStarted`, not `extraReducers`.** This is a dependency-graph argument:
`extraReducers` + `addMatcher(authApi.endpoints.login.matchFulfilled)` would force `authSlice →
authApi → baseApi → authSlice`, a **value-level cycle evaluated at module scope**, since the
`extraReducers` builder runs during module evaluation and would dereference a possibly-uninitialised
`authApi.endpoints`. With `onQueryStarted` the arrow is one-way.

```
login     → dispatch(credentialsReceived({ accessToken, user }))
logout    → try { await queryFulfilled } catch {} finally { dispatch(loggedOut()) }
logoutAll → same as logout    // cleared locally even if the request fails — sign out must work offline
me        → dispatch(userLoaded(data))
```
Always wrap `await queryFulfilled` in try/catch (unhandled rejection warning), matching
`TaskForm.tsx`'s `catch { // Surfaced through error below }` idiom.

**Cache reset between users: call `baseApi.util.resetApiState()` at the top of `LoginPage`'s submit
handler, not in `logout.onQueryStarted`.** At logout time `TaskList`'s query still has a live
subscriber, so a reset triggers an immediate refetch → 401 → a refresh against a cookie the server
just cleared: a burst of pointless requests. On `/login` nothing authenticated is mounted, and that
is exactly when "user B must not inherit user A's cache" starts to matter.

## 3.5 Bootstrap — `src/features/auth/bootstrapAuth.ts` (new), dispatched from `main.tsx`

```ts
export async function bootstrapAuth(dispatch: AppDispatch): Promise<void> {
  const attempt = dispatch(authApi.endpoints.refresh.initiate())
  try { await attempt.unwrap() }          // credentialsReceived fires via onQueryStarted
  catch { /* No cookie, expired, or revoked. Staying anonymous is correct. */ }
  finally { attempt.reset(); dispatch(bootstrapFinished()) }
}
```

Called at module scope in `main.tsx` **before** `createRoot(...).render(...)`, not in a `useEffect`.
⚠️ A `useEffect` runs twice under StrictMode, and with rotation the second call presents a token the
first already burned → 401 → you appear logged out **only in development**, which is a spectacularly
confusing bug to chase. Module scope runs once and deletes the question entirely. It also starts the
request a frame or two before React mounts.

**No login flash:** `App` renders a splash — not the router — until `bootstrapped` flips. The URL is
untouched during the splash, so a deep link to `/sessions` lands on `/sessions`. No redirect, no
lost destination.

## 3.6 Components (all named exports; only `App` stays default)

Match the existing Tailwind idiom exactly: cards `rounded-lg border border-slate-200 bg-white p-4
shadow-sm`, primary button `h-[38px] rounded-md bg-indigo-600 px-4 text-sm font-medium text-white
transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300`, field errors
`mt-1 text-xs text-red-600` with `aria-invalid`, the `…` character in loading labels. Reuse
`errorMessage` / `fieldErrors` / `toApiError` from `src/lib/api-error.ts` — the backend's
class-validator emits `email`/`password` field paths, so `fieldErrors` maps straight onto the form.

| File | Export | Notes |
|---|---|---|
| `src/app/router.tsx` | `router` | `createBrowserRouter`. `/login` public; a `RequireAuth` **layout route** wrapping `/` (→ `/tasks`), `/tasks`, `/sessions`, `*` |
| `src/features/auth/LoginPage.tsx` | `LoginPage` | Email/password, `useLoginMutation`, `resetApiState()` before submit, redirect to `location.state.from ?? '/tasks'`, `<Navigate to="/tasks" replace />` if already authed |
| `src/features/auth/RequireAuth.tsx` | `RequireAuth` | Anonymous → `<Navigate to="/login" state={{ from: pathname + search }} replace />`. **No loading state** — `bootstrapped` is already true by the time the router exists; comment that invariant |
| `src/app/AppShell.tsx` | `AppShell` | `<AppHeader/>` + `main.mx-auto.max-w-3xl.px-4.py-10` + `<Outlet/>` |
| `src/features/auth/AppHeader.tsx` | `AppHeader` | `NavLink`s to `/tasks` + `/sessions`, current user, Sign out (`useLogoutMutation`). `useMeQuery(undefined, { skip: Boolean(user) })` as a self-healing fallback. No navigate needed — `loggedOut()` flips `isAuthenticated` and `RequireAuth` redirects |
| `src/features/sessions/SessionsPage.tsx` | `SessionsPage` | Four states mirroring `TaskList.tsx` verbatim (loading / error card with Retry / empty / list) + a "Sign out everywhere" button |
| `src/features/sessions/SessionItem.tsx` | `SessionItem` | `userAgent`, `ipAddress`, relative `lastUsedAt` (small local helper, no date lib), emerald `This device` pill using `TaskItem`'s pill classes, Revoke button using `TaskItem`'s delete styling. For the current session label it **Sign out** and add a `window.confirm` — revoking yourself correctly cascades to a logout, but should not be a surprise click |
| `src/features/tasks/TasksPage.tsx` | `TasksPage` | Extracted from today's `App.tsx`; the outer `div`/`main` move to `AppShell` |

## 3.7 Edits to existing frontend files

- **`main.tsx`** — `import { bootstrapAuth } from './features/auth/bootstrapAuth.ts'` (keep this
  file's explicit `.ts`/`.tsx` extensions) and `void bootstrapAuth(store.dispatch)` before `render`.
- **`App.tsx`** — body replaced: `if (!bootstrapped) return <BootSplash />; return <RouterProvider router={router} />`.
  `BootSplash` is a non-exported local. Still `export default App`.
- **`app/store.ts`** — repoint `baseApi` to `./baseApi`, add `auth: authReducer`. Middleware unchanged.
- **`features/tasks/tasksApi.ts`** — delete the imports/`apiRoot`/`createApi` block (~L1-27), add
  `import { baseApi } from '../../app/baseApi'`. Everything from `export const tasksApi =` down is
  untouched. `store.ts` was the only other importer of `baseApi`.
- **`vite-env.d.ts`** — **no change.** No new `VITE_` var is needed. (Stated explicitly because the
  closed `ImportMetaEnv` interface makes this an easy place to slip up.)
- **`.oxlintrc.json`** — no change; `react/only-export-components` won't fire, since no file exports
  both a component and a hook/selector.

## 3.8 Multi-tab semantics — **per-tab client state, one shared server session**

This is a deliberate design property, not an oversight, and it is the thing a future reader is most
likely to get wrong. Document it as a docblock at the top of `authSlice.ts` **and** in CLAUDE.md's
auth section.

> **Auth state is per-tab. Only the refresh cookie is shared.**
> The access token lives in each tab's Redux store, which is per-JS-context. The refresh cookie is
> one browser-wide slot (fixed name, host-only, `Path=/api/v1/auth`). So: `loggedOut()` in one tab
> does **not** log out other tabs — they keep working off their in-memory access token until it
> expires (≤ `JWT_ACCESS_EXPIRES_IN`) or they hit a 401, at which point their refresh fails against
> the cleared/revoked cookie and *then* they fall back to `/login`. Convergence is by expiry, not by
> broadcast. Do not assume synchronous cross-tab logout.

**Why not fix it with `BroadcastChannel`:** out of scope, and it would be a second source of truth
for auth state living outside Redux. Revisit only if a product requirement demands instant cross-tab
logout. Note in the docblock that this is the intended extension point.

### The two races this creates, and what the plan does about each

**1. Stale `loggedOut()` clobbering a fresh login (same tab).** Request A 401s → refresh starts →
the refresh hangs → meanwhile a login completes and dispatches `credentialsReceived` → the stale
refresh finally fails → `loggedOut()` wipes a session that is perfectly valid. **Fixed** by the
token snapshot in §3.3: only dispatch `loggedOut()` if the token in state is still the one the
request failed under. Two lines, no dependency. This also covers the cross-tab flavour you get when
the second tab's login rotates the shared cookie out from under an in-flight refresh in the first.

**2. Orphaned sessions from a second explicit login (not fixed by the above).** Sharper than the
`loggedOut()` race and worth stating plainly: because the cookie is a **single shared slot**, a
second login in the same browser overwrites it. The first session is never revoked — its refresh
token is simply now unreachable, so it sits `revokedAt IS NULL, expiresAt > now()` for the full
30 days and shows up as a **ghost device in `GET /sessions`** that the user cannot recognise and
whose "Revoke" does nothing observable. Every re-login in the same browser leaves one behind.

**Mitigation — in scope, implemented in §2.9's `login`:** read the refresh cookie on the login
request; if it resolves to a live session, revoke that session before issuing the new one.
Precise, because the only way to present that cookie is to *be* the browser whose token is about
to be overwritten. It does not touch other devices — they have their own cookies. E2e coverage
lives in Verification step 6 (same-agent double login → `meta.total === 1`).

The `MAX_SESSIONS_PER_USER` cap (§2.8a) remains the backstop for every leak path this precise fix
doesn't cover.

---

# Build order

Each step compiles on its own (`tsc -b` with `noUnusedLocals` will bite if staged out of order).

**Backend:** contracts → `./dev.sh contracts` → `duration.ts` → `yarn add -D @types/cookie-parser`
→ env schema + `.env.example` → entities → migration → `yarn migration:run` → `refresh-cookie.ts`
→ `UsersService` → `SessionsService` → `AuthService` → DTOs → controllers (+ origin guard) →
module wiring + `configure-app.ts` → specs → e2e.

**Frontend:** `yarn add react-router@^7` → `authSlice` + register in `store.ts` (app still works
unchanged) → `app/baseApi.ts`, trim `tasksApi.ts`, repoint `store.ts` → `authApi` + `bootstrapAuth`
+ wire `main.tsx` → `LoginPage`/`RequireAuth`/`AppHeader`/`AppShell`/`router`/`TasksPage` + rewrite
`App.tsx` (**first end-to-end login possible here**) → `sessionsApi`/`SessionsPage`/`SessionItem`.

**Docs last:** README (7 new routes + an Auth subsection), CLAUDE.md (rewrite "Current state — auth
is half-built"; add the session/refresh-token split, the grace window, the commit-then-throw rule,
"`SessionsModule` must never import `AuthModule`", and the `baseApi` path change).

---

# Verification

## Automated

```bash
cd backend && yarn lint && yarn test          # unit
cd backend && yarn test:e2e                   # needs live Postgres
cd frontend && yarn lint && yarn build
```

**Existing specs that break and must be updated:**

| File | Why |
|---|---|
| `auth/jwt-auth.guard.spec.ts` | **Does not break** — the payoff of the child-table design |
| `auth/auth.service.spec.ts` | Repo provider → `UsersService` mock; `login` return shape gains `user`/`expiresIn`; `create` now takes a context arg. The five `createToken` cases are untouched |
| `auth/auth.controller.spec.ts` | Rewrite — handlers now take `@Req`/`@Res`; needs fake `res.cookie`/`clearCookie`, fake `req.cookies`/`header`/`ip`, a `ConfigService` provider |
| `sessions/sessions.service.spec.ts` | Heavy — all three `create` cases inspect `refreshTokenHash`, **a column that no longer exists**. Re-point at the `RefreshTokenEntity` mock + a `manager.transaction` mock. The `isActive` cases are unaffected |
| `users/users.service.spec.ts` | Compile-only — add a `getRepositoryToken(UserEntity)` mock |

**New unit specs:** `common/duration.spec.ts`; `auth/refresh-cookie.spec.ts` (**highest value** —
assert set/clear produce *identical* `httpOnly`/`secure`/`sameSite`/`path`/`domain`, `maxAge` only on
set, `httpOnly` unconditionally true); `sessions.service.spec.ts` additions driving `rotateWithin`
against a fake manager (happy path, **reuse detection — assert the writes happened *and* the callback
returned rather than threw**, grace window accepted, expired/unknown/revoked → `invalid` with no
revocation); `sessions.controller.spec.ts`; `auth/dto/auth-response.dto.spec.ts` (pins the `@Type()`
footgun — asserts `user.email` exposed and `passwordHash` dropped).

**New `backend/test/auth.e2e-spec.ts`** using `request.agent(...)` (supertest's agent carries a
cookie jar):
1. Login → 200, `set-cookie` has `HttpOnly; SameSite=Lax; Path=/api/v1/auth`, and **no
   `refreshToken` key** anywhere in the body.
2. Full cycle: login → bearer `GET /tasks` 200 → refresh 200 with a *different* cookie → refresh again 200.
3. **Reuse detection:** capture cookie #1, refresh, replay #1 → 401; then the *current* cookie is
   also dead (refresh → 401) **and** the previously-valid access token 401s with `Session is no
   longer active`. That last assertion proves rotation, family revocation, and the guard all line
   up. Run with `REFRESH_ROTATION_GRACE_MS=0` — this is exactly why it is an env var. Add a sibling
   case at the default grace asserting a fast replay is *accepted* — and that a further replay of
   the same token **after** the grace window (measured from its *first* use) is rejected and
   revokes the family. That last assertion is what catches a sliding-window implementation, i.e.
   one that re-stamps `usedAt` on the grace path (§2.8 step 4).
4. Logout → 204 + expired cookie → the still-unexpired access token now 401s.
5. Logout-all: two agents, same user → logout-all from A → B's `/tasks` **and** B's refresh both 401.
6. Sessions: two logins **from two separate agents** (fresh cookie jars — a second login from the
   *same* agent presents the first login's cookie and §2.9 revokes that session, leaving total at
   1) → `meta.total === 2`, exactly one `current: true` → DELETE the other → 204, total 1. Random
   UUID → 404. Non-UUID → 400 from `ParseUUIDPipe`. Then the §2.9 counterpart: log in twice with
   the **same** agent → `meta.total === 1`.
7. **Session cap (§2.8a):** run with `MAX_SESSIONS_PER_USER=3`, log in four times — **each from a
   fresh agent**, or the §2.9 same-browser revocation, not the cap, is what trims the list → `GET /sessions`
   `meta.total === 3`, the first login's access token now 401s with `Session is no longer active`,
   and its row still exists in the DB with `revokedAt` set (**revoked, not deleted** — query it
   directly; the list endpoint filters it out, so the assertion has to go past the API). Then a
   fifth login → still 3. Unit-test the ordering separately: give one session a recent `lastUsedAt`
   and an older `createdAt`, and assert it outlives a session created later but never used — that
   is the `COALESCE` behaviour, and a bare `ORDER BY lastUsedAt` passes every other case.

⚠️ These are the **first mutating e2e tests** (`app.e2e-spec.ts` is read-only). Add an `afterAll`
cleaning the seed user's sessions, or point `test:e2e` at a scratch database. The README already
lists "e2e test database" as a known gap; this makes it start to matter.

## Manual — `./dev.sh`, then `http://localhost:5173`, seed user `rashiqrahaman@yahoo.com` / `Password123!`

1. **Boot** — `/` → splash → `/login`, with exactly **one** `POST /auth/refresh` (401) in Network.
2. **Sign in** → lands on `/tasks`, header shows the name.
3. **Token is memory-only** (the load-bearing check) — Application ▸ Local Storage *and* Session
   Storage empty; `localStorage.length` → `0`. The refresh cookie is present with **HttpOnly ✓**, and
   `document.cookie` in the console must **not** contain it. Login's response body has `accessToken`
   and **no `refreshToken`**.
4. **Silent refresh** — hard-reload on `/tasks`: splash → `POST /auth/refresh` 200 → tasks render,
   **no `/login` flash**. Hard-reload on `/sessions` → you land back on `/sessions`.
5. **Access-token expiry** — set `JWT_ACCESS_EXPIRES_IN=10s` in `backend/.env`, `./dev.sh restart
   backend`, sign in, wait ~12s, toggle a task. Network must show `PATCH` **401** → `refresh` **200**
   → `PATCH` **200**, with no flicker to `/login`. (Quick alternative without a restart: dispatch
   `{"type":"auth/credentialsReceived","payload":{"accessToken":"garbage"}}` in Redux DevTools.)
6. **Concurrent-401 stampede** (most likely thing to be broken) — still at `10s`, sit on `/sessions`
   past expiry, then navigate to `/tasks` so several requests fire together. Filter Network on
   `refresh`: **exactly one**. Two or more means `refreshInFlight` isn't shared.
7. **No refresh on a login 401** — sign in with a wrong password: red banner, **zero**
   `/auth/refresh` calls. One appearing means `NEVER_REAUTH` isn't matching `api.endpoint`.
8. **Logout** → cookie gone from Application ▸ Cookies; browser Back to `/tasks` bounces to
   `/login`; hard reload → 401 → login page, no loop.
9. **Dead session** — `update sessions set "revokedAt" = now() where id = '…'`; next action → 401 →
   refresh 401 → login page, exactly one refresh attempt.
10. **Sessions view** — sign in from a private window so two exist; `/sessions` lists both with one
    `This device`; revoke the other → row disappears without a manual reload (proves `Session/LIST`
    invalidation); revoke *this device* → confirm → back to `/login`. "Sign out everywhere" → both
    browsers hit `/login` on their next request.

11. **Multi-tab (§3.8)** — with `JWT_ACCESS_EXPIRES_IN=10s`: open `/tasks` in two tabs of the *same*
    browser, sign out in tab A. Tab B must keep working until its access token expires, then land on
    `/login`. That lag is correct — confirm it matches the documented behaviour rather than looking
    like a bug. Then, in one tab, throttle the network, force a 401 so a refresh hangs, and sign in
    from the other tab: the fresh login must **survive** (the §3.3 token snapshot). Finally, log in twice in one browser and
    confirm `GET /sessions` shows one row, not two (the §2.9 same-browser revocation).

Restore `JWT_ACCESS_EXPIRES_IN` to `15m` afterwards.

---

# Known risks

1. **The rollback trap (§2.8).** Throwing inside the transaction rolls back the family revocation and
   the reuse detector silently becomes a no-op that *looks* correct in casual testing. Highest-severity
   trap in the feature; the e2e case in step 3 is what catches it.
2. **`FOR UPDATE` + join.** `findOne({ lock, relations })` throws in TypeORM and Postgres rejects
   `FOR UPDATE` on an outer join's nullable side. Lock the token row alone.
3. **Asymmetric cookie clear.** One differing option and logout silently doesn't work. Mitigated by
   the single helper + its spec.
4. **`req.ip` is the proxy's IP** without `trust proxy` — the session list is misleading behind a load
   balancer. Comment it; treat as a separate deployment change.
5. **Forgetting `./dev.sh contracts`** — contracts are copied, not linked, so both sides keep
   compiling against a stale `dist/` and the `implements` clause silently stops guarding anything.
6. **Session growth — now handled in scope** by `MAX_SESSIONS_PER_USER` (§2.8a). Rate limiting
   remains out of scope: the cap bounds stored rows, but nothing yet bounds *attempts*, so login and
   refresh are still brute-forceable and `RATE_LIMITED` still has no producer. README follow-up.
7. **Moving `baseApi`** contradicts the literal text of CLAUDE.md and README — the doc edit must land
   in the same change.
8. **Cross-tab logout is not synchronous, by design (§3.8).** Other tabs converge by access-token
   expiry, not by broadcast. The likely future misreading is "logout in one tab logs out all tabs" —
   it does not. Documented in `authSlice.ts` and CLAUDE.md rather than fixed with `BroadcastChannel`.
