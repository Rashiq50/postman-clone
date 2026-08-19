# Domain model + the collections/requests tree (slice 1)

## Context

The repo is called `postman-clone` but there is no Postman domain in it. Today the only
business entity is `Task` — a CRUD placeholder scoped by `ownerId` — sitting on a finished auth
system (users, sessions, refresh-token rotation, registration, throttling). [README.md](README.md)
and [CLAUDE.md](CLAUDE.md) mention "workspace" only in the yarn sense; organizations,
workspaces, collections, folders, requests, environments, memberships and roles exist nowhere in
code or docs.

This change does two things, and the first is the reason for the second:

1. **Declares the tenancy model**, so every table added from here hangs off the right parent.
   The eventual shape is
   `User → Organization → Workspace → { Collection → Folder → Request, Environment, Membership → Role }`.
2. **Builds the first real slice of it**: workspaces + memberships, collections, folders,
   requests and environments, with a left-hand sidebar tree and a request editor that saves.

Ordering matters for one specific reason. `organizations` attaches *above* `workspaces` later
through a nullable FK — one table touched, no backfill. Retrofitting `workspaceId` onto a
populated `collections`/`requests`/`environments` set is a backfill plus a rewrite of every
service's scoping clause. So workspaces are built now and organizations are deferred.

**Out of scope, deliberately**: sending requests. No execution engine, no `{{var}}`
interpolation, no response pane, no history. Send carries its own security surface (SSRF,
redirects, timeouts, response size caps) and gets its own slice. Everything here saves;
nothing fires.

### Decisions already made

| Decision | Choice |
|---|---|
| Tenancy depth | `workspaces` + `workspace_members` now; `organizations` deferred behind a nullable `organizationId` seam |
| Tree model | Separate `folders` (adjacency list) + `requests` tables, not a unified polymorphic node table |
| Request storage | Hybrid — `name`/`method`/`url` as columns, `headers`/`queryParams`/`body`/`auth` as typed `jsonb` |
| Slice scope | Schema + API + sidebar tree + request editor. **No Send.** |
| Authorization | Membership folded into every SQL statement. No guard, no interceptor. |
| Ordering | `position integer`, gaps of 1024, reindex on demand. No drag-and-drop in slice 1. |

### Cross-cutting rules (from CLAUDE.md — binding)

- `packages/contracts` is **copied, not linked**: `./dev.sh contracts` after every edit.
- Response DTOs `implements <Contract>` so drift is a compile error; `@Expose()`-only with
  `excludeExtraneousValues`. Never return an entity from a controller.
- **Never a TS `enum` in contracts** — const objects only (`erasableSyntaxOnly`).
- Every route is authenticated by default (global `APP_GUARD`); `@Public()` opts out.
- Lists return `{ data, meta }`, never a bare array.
- Migrations only, hand-written raw SQL, `synchronize: false` everywhere.
- One `createApi` on the frontend; features extend `baseApi` via `injectEndpoints`.

---

## 1. The domain model

```
User ──< WorkspaceMember >── Workspace ──< Collection ──< Folder (self-nesting)
                                 │             └───────< Request
                                 └───────────< Environment

        [ Organization ]        ← DEFERRED. workspaces."organizationId" is the seam.
        [ OrganizationMember ]  ← DEFERRED.
```

### 1.1 `workspaces`

| column | type | null | notes |
|---|---|---|---|
| `id` | `uuid` | no | PK, `DEFAULT uuid_generate_v4()` |
| `organizationId` | `uuid` | **yes** | reserved seam — no FK, no table, always NULL today |
| `ownerUserId` | `uuid` | no | FK → `users(id)` **ON DELETE CASCADE** |
| `name` | `varchar(120)` | no | |
| `isPersonal` | `boolean` | no | `DEFAULT false` |
| `createdAt` / `updatedAt` | `timestamptz` | no | |

- `IDX_workspaces_ownerUserId`
- `IDX_workspaces_organizationId` — **partial**, `WHERE "organizationId" IS NOT NULL`, so it
  costs nothing while every row is NULL
- `UQ_workspaces_personal_owner` — **partial unique**, `ON ("ownerUserId") WHERE "isPersonal"`.
  One personal workspace per user, enforced by the database, which is also what makes
  provisioning and the backfill idempotent.

⚠️ `ownerUserId ON DELETE CASCADE` is correct *only while every workspace is personal*. When
sharing lands it must become `RESTRICT` plus an ownership-transfer endpoint, or deleting one
user silently deletes a team's collections. It is also what makes the e2e cleanup work, so it
cannot be changed casually.

### 1.2 `workspace_members`

`id`, `workspaceId` → `workspaces` CASCADE, `userId` → `users` CASCADE,
`role varchar(16)` with `CHK_workspace_members_role CHECK ("role" IN ('OWNER','ADMIN','EDITOR','VIEWER'))`,
timestamps.

- `UQ_workspace_members_workspace_user` UNIQUE `("workspaceId","userId")` — a duplicate is a
  23505, not a silently-doubled join result.
- `IDX_workspace_members_userId` — drives every authorization query.

**`varchar` + `CHECK`, not a Postgres enum type**, deviating from `tasks_status_enum` on
purpose. On PG 12+ `ALTER TYPE … ADD VALUE` does work inside a transaction, but the new value
cannot be *used* until it commits, and there is no cheap way to remove or rename one — so
changing an enum is always a multi-migration dance. A `CHECK` is `DROP CONSTRAINT` +
`ADD CONSTRAINT` in one statement. Role sets churn; task status did not. The const object in
contracts remains the single source of truth either way.

### 1.3 `collections`

`id`, `workspaceId` → `workspaces` CASCADE, `name varchar(200)`, `description text NULL`,
`position integer NOT NULL`, timestamps.
`IDX_collections_workspaceId_position` on `("workspaceId","position")`.

**No `DEFAULT` on any `position` column, anywhere.** The service always assigns
`MAX + 1024` (§3); a default is a value the ordering logic never produces, so the only
thing it can ever do is mask a code path that forgot to compute one — better as a
not-null violation than as a row silently sorted first.

**No uniqueness on `name`.** Postman allows duplicate names, and a 409 here is a worse
experience than two identically-named collections.

### 1.4 `folders`

`id`, `collectionId` → `collections` CASCADE, `parentFolderId uuid NULL` (NULL = collection
root), `name varchar(200)`, `position integer`, timestamps.
`IDX_folders_collectionId_parent_position` on `("collectionId","parentFolderId","position")`.

`collectionId` is denormalized — the parent chain implies it — so the tree read is one flat
`SELECT` per table and the authorization join is one hop instead of a recursion.

```sql
-- Redundant against the PK on its own. It exists so the composite FKs below
-- have a unique constraint to reference.
ALTER TABLE "folders" ADD CONSTRAINT "UQ_folders_id_collectionId" UNIQUE ("id", "collectionId");

ALTER TABLE "folders" ADD CONSTRAINT "FK_folders_parent"
  FOREIGN KEY ("parentFolderId", "collectionId")
  REFERENCES "folders"("id", "collectionId") ON DELETE CASCADE;
```

The composite self-FK makes "my parent is in a different collection" **unrepresentable in SQL**
rather than a service invariant someone forgets, and deleting a folder cascades its whole
subtree recursively with no service code.

Deliberate consequence: a folder cannot change `collectionId` without rewriting every
descendant, so **cross-collection move is out of scope** — and the schema says so, not the docs.

### 1.5 `requests`

| column | type | null | notes |
|---|---|---|---|
| `id` | `uuid` | no | PK |
| `collectionId` | `uuid` | no | FK → `collections` CASCADE |
| `folderId` | `uuid` | **yes** | NULL = collection root |
| `name` | `varchar(200)` | no | |
| `method` | `varchar(10)` | no | `DEFAULT 'GET'` + `CHK_requests_method CHECK (…)` |
| `url` | `text` | no | `DEFAULT ''` — a request exists before it has a URL |
| `description` | `text` | yes | |
| `headers` | `jsonb` | no | `DEFAULT '[]'::jsonb` — `KeyValueEntry[]` |
| `queryParams` | `jsonb` | no | `DEFAULT '[]'::jsonb` |
| `body` | `jsonb` | no | `DEFAULT '{"mode":"none"}'::jsonb` |
| `auth` | `jsonb` | no | `DEFAULT '{"type":"inherit"}'::jsonb` |
| `position` | `integer` | no | |
| `createdAt` / `updatedAt` | `timestamptz` | no | |

`IDX_requests_collectionId_folder_position`, plus the same composite FK:
`("folderId","collectionId") → folders("id","collectionId") ON DELETE CASCADE`.

⚠️ **`MATCH SIMPLE` (the Postgres default) is load-bearing.** With `folderId` NULL the composite
constraint is not checked at all — that is exactly how a request sits at the collection root.
`MATCH FULL` would forbid every root-level request, and the error would read as an FK bug rather
than a semantics change.

The hybrid split rule: anything the sidebar renders or the API filters on (`name`, `method`,
`url`, `position`, parents) is a real column; anything only the editor reads whole is `jsonb`.

### 1.6 `environments`

`id`, `workspaceId` → `workspaces` CASCADE, `name varchar(200)`,
`variables jsonb NOT NULL DEFAULT '[]'::jsonb` (`{key,value,enabled,secret?}[]`),
`position integer`, timestamps. `IDX_environments_workspaceId_position`.

**Scope honesty:** the table, contracts and REST CRUD are built now — it is twenty lines of
migration and the point of this change is to declare the model. **No environment UI is built in
this slice.** An environment editor with no `{{var}}` interpolation is a form that does nothing
observable; it ships with the execution slice.

Also deferred: **"active values"** — which environment is selected. It has no consumer until
interpolation exists; when Send lands it becomes a `workspace_members.activeEnvironmentId`
column.

⚠️ **Secrets are plaintext.** `environments.variables` and `requests.auth` hold bearer tokens
and passwords unencrypted, and `GET /requests/:id` returns them. This is what Postman does and
it is an accepted slice-1 trade-off — but it goes in the README in this change, or it becomes
an invisible default. The fix is a separate write-only secrets table with envelope encryption.

### 1.7 The organization seam (not built)

```sql
CREATE TABLE "organizations" (…);
CREATE TABLE "organization_members" (…);
ALTER TABLE "workspaces" ADD CONSTRAINT "FK_workspaces_organizationId"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE NOT VALID;
ALTER TABLE "workspaces" VALIDATE CONSTRAINT "FK_workspaces_organizationId";
```

Why that is cheap, precisely:

1. **No column is added** — `organizationId` already exists and is nullable, so no table
   rewrite, no `NOT NULL` backfill.
2. **No data migration** — every existing row means "personal, no org", which is already
   exactly `organizationId IS NULL`.
3. **`NOT VALID` + `VALIDATE`** keeps the lock brief and the scan non-blocking.
4. **No unique constraint includes `organizationId`** — workspace names are not unique at all,
   so nothing has to be dropped and re-scoped.
5. **No read path changes** — every query here reaches a workspace through `workspace_members`.
   Orgs add a *second* source of membership, which is one extra `UNION` branch in one file.
6. **No route changes** — routes are `/workspaces/:id/...`, never `/orgs/:orgId/workspaces/:id`.

The only thing deferring makes harder is the policy question "does an org ADMIN implicitly get
EDITOR on every workspace in the org" — and that lives in one function.

---

## 2. Access control — the crux

**Rule: membership travels inside the statement that reads or writes. No authorization guard.**

This is `TasksService`'s pattern lifted one level: instead of `WHERE "ownerId" = :ownerId`, it
is `WHERE "collectionId" IN (<collections I can write to>)`. The row is never materialized, and
there is no interval between check and act.

`backend/src/workspaces/workspace-scope.ts` — **plain exported functions and SQL fragments, not
an `@Injectable()`**. Same reasoning already recorded for
[refresh-cookie.ts](backend/src/auth/refresh-cookie.ts): a provider forces
`CollectionsModule → WorkspacesModule` and `RequestsModule → WorkspacesModule` edges that buy
nothing, and a service holding a `Repository` bound to the default manager cannot enlist in a
caller's transaction anyway.

```ts
export const WRITE_ROLES = [OWNER, ADMIN, EDITOR] as const;
export const READ_ROLES  = [OWNER, ADMIN, EDITOR, VIEWER] as const;
export const ADMIN_ROLES = [OWNER, ADMIN] as const;

/** Collection ids inside a workspace the caller holds one of `:roles` in.
 *  Roles are bound as an array parameter (`= ANY(:roles)`), never interpolated. */
export const SCOPED_COLLECTION_IDS = `
  SELECT c."id" FROM "collections" c
  JOIN "workspace_members" m ON m."workspaceId" = c."workspaceId"
  WHERE m."userId" = :userId AND m."role" = ANY(:roles)
`;

/** Workspace ids the caller holds one of `:roles` in. The workspace-level
 *  sibling of SCOPED_COLLECTION_IDS: PATCH/DELETE /workspaces/:id and the
 *  environments endpoints scope on membership directly (there is no
 *  collection in the chain), and §2.2's role table — manage = ADMIN_ROLES,
 *  delete = OWNER only — connects to queries through this fragment's `roles`
 *  argument. Without it each service improvises its own membership JOIN and
 *  the "roles live nowhere but the array" rule quietly stops being true. */
export const SCOPED_WORKSPACE_IDS = `
  SELECT m."workspaceId" FROM "workspace_members" m
  WHERE m."userId" = :userId AND m."role" = ANY(:roles)
`;
```

`PATCH /requests/:id` is then one statement:

```ts
const result = await this.repo.createQueryBuilder()
  .update(RequestEntity).set(patch)
  .where(`"id" = :id AND "collectionId" IN (${SCOPED_COLLECTION_IDS})`,
         { id, userId, roles: [...WRITE_ROLES] })
  .returning('*').execute();

if (!result.affected) await this.explainDenial(userId, id);   // failure path only
```

### 2.0 The create path — the pattern above does not transfer, so spell it out

The `UPDATE … WHERE id AND collectionId IN (scoped)` shape covers update, move and
delete. **It does not cover `POST`** — there is no row to scope, `affected === 0` never
arises, and `explainDenial` keys on an id that does not exist yet. §2.1 point 2 calls the
unauthorized create "the single most likely bug in this slice"; leaving its mechanism
unspecified is how that bug ships. The mechanism:

Create is already a transaction whether we like it or not — it needs the sibling
`MAX("position") + 1024` read before the insert. So inside that transaction:

1. **Scoped parent resolve.** `SELECT c."id", c."workspaceId" FROM "collections" c WHERE
   c."id" = :collectionId AND c."id" IN (${SCOPED_COLLECTION_IDS})` with `WRITE_ROLES`.
   Zero rows → denial (below). If a `folderId` is in the body, resolve it the same way
   **and** assert `folder."collectionId" = :collectionId` — a folder from another
   collection is a 404, same reasoning as move targets.
2. The sibling `MAX("position")` read (`IS NOT DISTINCT FROM` on the parent, per §3.1).
3. The `INSERT`.

The check-then-insert gap this opens is closed by the FKs, not by hoping: if the
collection is deleted between 1 and 3, the insert fails on `FK_requests_collectionId` —
the race degrades to an error, never to a cross-tenant write. That is why a scoped
`SELECT` inside the transaction is acceptable here while a guard (§2.1) is not: the guard
trusts a check made *outside* the statement's transaction with no constraint backstop.

**Denial on create** cannot reuse `explainDenial` (no request id). A sibling helper keyed
on the parent: visible under `READ_ROLES` but not `WRITE_ROLES` → `403 FORBIDDEN`; not
visible at all → `404` naming the *collection* id. Same 404-vs-403 policy as §2.4,
anchored on the parent because the parent is what the caller named.

The same three-step shape applies to every create with a parent id in the body:
`POST /collections` (parent = workspace, via `SCOPED_WORKSPACE_IDS`), `POST /folders`
(parent = collection, plus the `parentFolderId`-same-collection assert),
`POST /environments` (parent = workspace).

### 2.1 Why not a guard — four failure modes, not stylistic ones

1. **TOCTOU.** The guard resolves membership, the service then trusts it and writes. In between,
   the membership row can be deleted or the request moved. The SQL-scoped design has no such
   interval — the identical argument the codebase already makes for `TasksService.remove`.
2. **It cannot see `POST`.** On `POST /requests` the parent id is in the **body**
   (`collectionId`), not in `:id`. A guard keyed on route params silently permits creating a
   request inside a stranger's collection — a full cross-tenant write, and the single most
   likely bug in this slice.
3. **It cannot see `move`.** `PATCH /requests/:id/move` has *two* parents. A guard on `:id`
   authorizes the source and waves the destination through.
4. **It is the same JOIN, run twice.** The service either repeats it (nothing saved) or trusts
   it (see 1).

Stated in one line: a `@WorkspaceMember(EDITOR)` guard on `:id` routes looks complete, passes
every hand test, and leaves `POST /requests` and every move destination unauthorized.

### 2.2 Roles

| role | read | write content | manage members | delete workspace / transfer |
|---|---|---|---|---|
| OWNER | ✓ | ✓ | ✓ | ✓ |
| ADMIN | ✓ | ✓ | ✓ | ✗ |
| EDITOR | ✓ | ✓ | ✗ | ✗ |
| VIEWER | ✓ | ✗ | ✗ | ✗ |

Exactly four because there are two independent yes/no questions — *can they edit content?* and
*can they administer the workspace?* — plus one singleton. Drop `ADMIN` and the only way to let
someone invite a colleague is to hand over ownership. Drop `VIEWER` and read-only sharing, the
most-requested mode, needs a migration.

**Role checks live nowhere but the `roles` argument** to the scope fragment. There is no
`if (role === 'VIEWER') throw`. Adding a role is editing one array.

**Invariant:** `workspaces.ownerUserId` and the `OWNER` membership row are two views of one
fact. Written together in `provisionPersonalWorkspace`, backfilled together in the migration.
Not enforced by a constraint (that would need a trigger) — enforced by there being one code
path that writes either.

### 2.3 Is VIEWER reachable in this slice? No

Honestly: no. Every workspace is personal, every membership row is `OWNER`, and there is no
invite endpoint. Build anyway, because it is nearly free and expensive to retrofit: the `role`
column, the const object, and **the `roles` array threaded through every query** — that last
part touches every service method, which is exactly why it should not be added later.

Plus **one e2e case that inserts a `VIEWER` membership with a raw `dataSource.query`** and
asserts `GET /tree` → 200 while `PATCH /requests/:id` → 403. Without it the roles array is
decoration that has never been observed working.

Do **not** build: `POST /workspaces/:id/members`, an invite flow, a members pane, a role
dropdown. No unused UI.

### 2.4 404 vs 403

- **Not a member** → `404`. Verbatim `TasksService.findOne` policy, for the reason recorded
  there: a 403 confirms the id is real and enables enumeration.
- **A member whose role is too low** → `403 FORBIDDEN`. Leaks nothing — they can already read
  the row. A 404 here would tell a VIEWER their own request does not exist.

The hot path stays one statement; the second query is paid only when the answer is an error:

```ts
/** Failure path only. Turns `affected === 0` into the right status. */
private async explainDenial(userId: string, id: string): Promise<never> {
  const visible = await this.repo.createQueryBuilder('r').select('1')
    .where(`r."id" = :id AND r."collectionId" IN (${SCOPED_COLLECTION_IDS})`,
           { id, userId, roles: [...READ_ROLES] })
    .getRawOne();
  if (visible) throw ApiException.forbidden('Your role does not permit this action');
  throw new NotFoundException(`Request with id "${id}" not found`);
}
```

---

## 3. Ordering

**`position integer`, gaps of 1024, reindex on demand.** New siblings get
`MAX(position) + 1024`; a move to index *i* gets `floor((before + after) / 2)`.

1024 rather than 1000 because binary halving between two integers 1024 apart yields exactly ten
clean levels — the exhaustion point is an exact, testable number rather than a rounding
accident. When `after - before < 2`, the move transaction renumbers that one sibling set to
`1024, 2048, …` and retries. Sibling sets are tens of rows.

Floats were the alternative and were rejected for debuggability (`0.30000000000000004`) and
because their exhaustion is silent rather than detectable. Contiguous reindex rewrites the whole
sibling set on every *create*, which makes optimistic insert impossible to express.

```ts
// backend/src/common/ordering.ts
export const POSITION_GAP = 1024;
/** `position` for an item landing at `index` among `siblings` (ascending, excluding
 *  the item being moved). 'reindex' when the neighbours are too close to split. */
export function positionForIndex(
  siblings: readonly { position: number }[], index?: number,
): number | 'reindex'
```

**Folders and requests do not interleave.** Two tables, two independent sequences; the tree
renders all folders first, then all requests — which is what Postman does. It removes the
cross-table `MAX()`, the cross-table lock, and the cross-table reindex.

Global ordering rule everywhere: `ORDER BY "position", "createdAt", "id"`. The trailing keys are
the safety net — two rows sharing a position still render deterministically instead of
flickering between refetches, which makes the sibling lock an optimization rather than a
correctness requirement.

### 3.1 Move endpoints

```
PATCH /api/v1/requests/:id/move     { folderId: string | null, index?: number }
PATCH /api/v1/folders/:id/move      { parentFolderId: string | null, index?: number }
PATCH /api/v1/collections/:id/move  { index: number }
```

`index` is the **0-based position among siblings after the move**, never a raw column value — a
client must not guess integers out of a sequence it does not control. Omitted means append.

Inside a transaction: resolve + scope the row, verify the target folder is in the same
collection, `SELECT … FOR UPDATE` the target parent's siblings, `positionForIndex`, update.

⚠️ **`IS NOT DISTINCT FROM`, not `=`, for the sibling query.** `"folderId" = $2` with `$2` NULL
is never true, so every root-level move computes against zero siblings and stacks everything at
1024, on top of whatever is already there.

**Concurrency**: `FOR UPDATE` serializes two moves into the same parent; moves into different
parents never contend. Absent the lock the worst case is a shared `position`, which the
`position, createdAt, id` tiebreak resolves into a stable order — so no corruption is possible
and the lock exists to make the *intended* order win.

⚠️ **Folder cycle check**, before the sibling read:

```sql
WITH RECURSIVE descendants AS (
  SELECT "id" FROM "folders" WHERE "id" = $1
  UNION ALL
  SELECT f."id" FROM "folders" f JOIN descendants d ON f."parentFolderId" = d."id"
)
SELECT 1 FROM descendants WHERE "id" = $2 LIMIT 1
```

`$1` = folder being moved, `$2` = proposed parent. A row back → `409 CONFLICT`, *"A folder
cannot be moved inside itself"*. The composite FK does **not** save you here: the cycle is
self-consistent, the rows orphan themselves out of the tree, and they become invisible and
undeletable through the UI.

### 3.2 No drag-and-drop in slice 1

No dnd library is installed, and hand-rolling HTML5 DnD over a nested tree (drop-target hit
testing, "between" vs "into", auto-scroll, auto-expand-on-hover) is a slice of its own.

Ship the `position` column and the `/move` endpoints — you need them anyway, since "Move to
folder…" *is* a `/move` call — and expose reordering as **"Move to…"**, **"Move up"** and
**"Move down"** in the node's kebab menu. Zero libraries, full coverage of the capability;
drag-and-drop later is a pure-frontend change against the same endpoint.

---

## 4. The tree endpoint

```
GET /api/v1/workspaces/:workspaceId/tree   →  WorkspaceTree
```

**Eager, whole workspace, one call.** Lazy per-collection saves nothing (the sidebar renders
every collection name on first paint anyway), then costs an N+1 pattern, a spinner and loading
state per node, and *more* invalidation complexity — a request moved between collections would
have to invalidate two independently-fetched trees the client must both know about.

What keeps eager cheap is that the tree is a **skeleton**: request nodes carry
`id, name, method, folderId, position` and nothing else — no `url`, `headers`, `body` or `auth`.
That is ~60–80 bytes per request; a 500-request workspace is ~35 KB. The editor fetches the full
row from `GET /requests/:id`.

Assembled server-side from **three flat queries** (collections, folders, requests for the scoped
workspace) nested by a pure function — not a recursive CTE, and testable without a database.

```ts
// packages/contracts/src/tree.ts
export interface RequestNode {
  id: string; name: string; method: HttpMethod;
  folderId: string | null; position: number;
}
export interface FolderNode {
  id: string; name: string; parentFolderId: string | null; position: number;
  folders: FolderNode[]; requests: RequestNode[];   // folders render first
}
export interface CollectionNode {
  id: string; name: string; description: string | null; position: number;
  folders: FolderNode[]; requests: RequestNode[];
}
export interface WorkspaceTree { workspaceId: string; collections: CollectionNode[] }
```

**Reconciling with "lists return `{ data, meta }`".** That rule is about *list endpoints*, so
that growing a bare array into a paginated response is never breaking. `/tree` returns **one
object resource**, exactly as `GET /auth/me` returns one `AuthUser`. Its inner arrays are
deliberately not paginable — half a tree is not a tree, and no page boundary makes sense across
a nesting level. The escape hatch for a too-large workspace is lazy *sub*trees, not a cursor
over this one. Mark `/tree` as a single-resource endpoint in the README; `GET /workspaces` **is**
a list and **does** return `Paginated<Workspace>`, so the rule visibly still holds.

`buildTree()` behaviours to pin in `build-tree.spec.ts`: folders before requests at every level,
then the three-key ordering; an orphan folder or request (parent id not in the set) attaches to
the collection root and is **logged, never dropped** — a silently vanishing subtree is
undiagnosable from the UI; an empty workspace yields `{ workspaceId, collections: [] }`.

---

## 5. Personal workspace provisioning

A user row with no workspace is a **silently and permanently broken account**: registration
still returns 201 with a working token, `GET /workspaces` is empty, the workbench has nothing to
show, and no endpoint repairs it. So the writes go in one transaction — placed inside
`UsersService.create`, keeping its signature:

```ts
create(email: string, passwordHash: string, name: string): Promise<UserEntity> {
  return this.usersRepository.manager.transaction(async (manager) => {
    const user = await manager.save(manager.create(UserEntity, { email, passwordHash, name }));
    await provisionPersonalWorkspace(manager, user.id);
    return user;
  });
}
```

`AuthService.register` needs **no change** — which is the point. `manager.transaction` re-throws
the driver error unchanged, so the `isUniqueViolation` → `EMAIL_TAKEN` catch still works and the
workspace rolls back with the user. Verify that in `auth.service.spec.ts` rather than assuming.

`backend/src/workspaces/provision-personal-workspace.ts` is a **plain function taking the
caller's `EntityManager`**, not an `@Injectable()` — a service holds a `Repository` bound to the
*default* manager, so enlisting in a caller's transaction would mean taking a manager argument
anyway, at which point injection buys nothing and only adds a `UsersModule → WorkspacesModule`
edge. It writes the workspace (`isPersonal: true`, `organizationId: null`) and the `OWNER`
membership, and nothing else writes either.

⚠️ `UQ_workspaces_personal_owner` means a second personal workspace for the same user is also a
23505 — which `AuthService.register`'s catch would report as `EMAIL_TAKEN`, a wrong and very
confusing error. It cannot happen on the register path (the user row is brand new), but a
second call site must handle it. Note it in the function's doc comment.

### 5.1 Backfill

In the same migration, after the tables exist. `NOT EXISTS` rather than a bare
`INSERT … SELECT`, so it is idempotent and composes with the partial unique index:

```sql
-- The literal name is duplicated with PERSONAL_WORKSPACE_NAME on purpose: a
-- migration must keep producing the same result forever, so it does not import
-- application code.
INSERT INTO "workspaces" ("ownerUserId", "name", "isPersonal")
SELECT u."id", 'My Workspace', true FROM "users" u
WHERE NOT EXISTS (
  SELECT 1 FROM "workspaces" w WHERE w."ownerUserId" = u."id" AND w."isPersonal");

-- Driven off `workspaces`, not `users`, so it also repairs a workspace whose
-- membership row was somehow lost.
INSERT INTO "workspace_members" ("workspaceId", "userId", "role")
SELECT w."id", w."ownerUserId", 'OWNER' FROM "workspaces" w
WHERE w."isPersonal" AND NOT EXISTS (
  SELECT 1 FROM "workspace_members" m
  WHERE m."workspaceId" = w."id" AND m."userId" = w."ownerUserId");
```

Verification query (must return 0):

```sql
SELECT count(*) FROM "users" u
LEFT JOIN "workspaces" w ON w."ownerUserId" = u."id" AND w."isPersonal"
WHERE w."id" IS NULL;
```

`down()` drops the tables, which takes the backfilled rows with them.

---

## 6. Backend files

### 6.1 Contracts — five new files

Boundaries follow **aggregates, not tables**: `Folder` never appears without `Collection`, so
they share a file; `WorkspaceRole` lives with `Workspace` because org roles will be a different
set in `organization.ts`.

| file | contents |
|---|---|
| `workspace.ts` | `WorkspaceRole` const object + `WORKSPACE_ROLES`, `Workspace` (incl. `organizationId: string \| null`, `isPersonal`, and **`role`** — the caller's own role, so the UI can disable buttons), `Create/UpdateWorkspaceInput` |
| `collection.ts` | `Collection`, `Folder`, their `Create/Update` inputs, `MoveFolderInput` |
| `request.ts` | `HttpMethod` + `HTTP_METHODS`, `KeyValueEntry`, `RequestBody` (union on `mode`: `none` / `raw` / `json` / `form-urlencoded`), `RequestAuth` (union on `type`: `inherit` / `none` / `bearer` / `basic` / `apiKey`), **`ApiRequest`**, `Create/Update/MoveApiRequestInput` |
| `environment.ts` | `EnvironmentVariable`, `Environment`, `Create/UpdateEnvironmentInput` |
| `tree.ts` | the node interfaces in §4 |

All re-exported from `index.ts`. ⚠️ Const objects only — never a TS `enum`.

⚠️ **The wire type is `ApiRequest`, not `Request`.** `Request` is a DOM global and an
`@types/express` type; a contracts export by that name shadows both and the compile errors point
at the wrong files. Entity stays `RequestEntity`; table stays `requests`.

### 6.2 Modules and entities

```
backend/src/workspaces/     WorkspaceEntity, WorkspaceMemberEntity, WorkspacesService,
                            WorkspacesController, workspace-scope.ts,
                            provision-personal-workspace.ts
backend/src/collections/    CollectionEntity, FolderEntity, CollectionsService, FoldersService,
                            TreeService, build-tree.ts, + their controllers
backend/src/requests/       RequestEntity, RequestsService, RequestsController
backend/src/environments/   EnvironmentEntity, EnvironmentsService, EnvironmentsController
backend/src/common/         ordering.ts
```

`TreeController` lives in `collections/` even though its path starts `workspaces/` — Nest does
not care which module declares a path, and this keeps `WorkspacesModule` free of a
`CollectionsModule` edge. **No module imports `WorkspacesModule`**, because `workspace-scope.ts`
and `provision-personal-workspace.ts` are plain functions — the `refresh-cookie.ts` precedent,
and what keeps the dependency graph a straight line. Register the four modules in
[app.module.ts](backend/src/app.module.ts) after `SessionsModule`. **No new env vars**, so
`env.validation.ts` is untouched.

Entity conventions, verified against
[session.entity.ts](backend/src/sessions/entities/session.entity.ts):
`@PrimaryGeneratedColumn('uuid')`; `@ManyToOne(…, { onDelete: 'CASCADE', nullable: false })` +
`@JoinColumn({ name })` + `@RelationId`; **every index named explicitly**
(`@Index('IDX_folders_collectionId_parent_position', [...])`) for the reason recorded on
`SessionEntity.userId`; `timestamptz` on `@CreateDateColumn`/`@UpdateDateColumn`. Two traps:

```ts
// jsonb defaults must be SQL expressions, or migration:generate sees a mismatch
// between the entity's JS default and the column's DB default and emits churn.
@Column({ type: 'jsonb', default: () => `'[]'::jsonb` }) headers: KeyValueEntry[];

// varchar, NOT type: 'enum' — an enum column makes TypeORM want to create a
// Postgres enum type the migration never created.
@Column({ type: 'varchar', length: 10, default: 'GET' }) method: HttpMethod;
```

`FolderEntity.parentFolder` is a self `@ManyToOne` with `@JoinColumn({ name: 'parentFolderId' })`;
TypeORM cannot express a two-column FK, so **the migration owns the composite constraint** and
the entity declares only the single-column relation. Comment this in both files, or a future
`migration:generate` tries to "add" the missing single-column FK.

### 6.3 DTOs

Per resource: `create-*.dto.ts`, `update-*.dto.ts`, `move-*.dto.ts`, `*-response.dto.ts`. Every
response DTO `implements <Contract>`, is `@Expose()`-only, built with
`plainToInstance(…, { excludeExtraneousValues: true })` plus `from`/`fromMany` statics — copy
[task-response.dto.ts](backend/src/tasks/dto/task-response.dto.ts) exactly, including the
`@Transform` that turns a `Date` into an ISO string.

⚠️ **Validate the jsonb unions with a single custom `@Validate` constraint each**, not
`@ValidateNested` + `@Type`. Two reasons, both real: the global pipe runs `whitelist: true`, so
a nested decorated class **strips any key it does not declare** — silently mangling a body the
client sent — while a plain object checked by a constraint passes through untouched; and one
union through `@ValidateNested` produces a pile of overlapping messages. This is the same
precedent the password rule already set (one constraint, one message).

```ts
@ValidatorConstraint({ name: 'requestBody' })
export class RequestBodyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean { /* switch on value.mode */ }
  defaultMessage() { return 'body must be one of: none, raw, json, form-urlencoded'; }
}
```

Same for `RequestAuthConstraint` and `KeyValueEntriesConstraint`.

### 6.4 Routes

| method | route | response |
|---|---|---|
| `GET` | `/api/v1/workspaces?page=&limit=` | `Paginated<Workspace>` |
| `POST` `GET` `PATCH` `DELETE` | `/api/v1/workspaces[/:id]` | `Workspace` / 204 (**409 if personal**) |
| `GET` | `/api/v1/workspaces/:id/tree` | `WorkspaceTree` — single resource |
| `GET` | `/api/v1/workspaces/:id/environments` | `Paginated<Environment>` — list is nested: a workspace id is not derivable from anything else |
| `POST` | `/api/v1/environments` | `Environment` — create is flat with `workspaceId` in the body, the same rule as every other resource |
| `POST` `PATCH` `DELETE` | `/api/v1/collections[/:id]` | `Collection` / 204 |
| `PATCH` | `/api/v1/collections/:id/move` | `Collection` |
| `POST` `PATCH` `DELETE` | `/api/v1/folders[/:id]` | `Folder` / 204 |
| `PATCH` | `/api/v1/folders/:id/move` | `Folder` |
| `POST` `GET` `PATCH` `DELETE` | `/api/v1/requests[/:id]` | `ApiRequest` / 204 |
| `PATCH` | `/api/v1/requests/:id/move` | `ApiRequest` |
| `PATCH` `DELETE` | `/api/v1/environments/:id` | `Environment` / 204 |

**Flat top-level resources with the parent id in the `POST` body**, matching `TasksController` —
one consistent rule, and a request's URL does not change when it moves between folders, so a
bookmarked editor link survives a reorganization. The two genuinely nested routes (`/tree`,
`/environments`) are nested because a workspace id is not derivable from anything else.

Every handler takes `@CurrentUser() user: AuthenticatedUser` and passes `user.userId` first. A
workspace id in a body is a **scoping input checked against membership**, never an identity.
`@Param('id', ParseUUIDPipe)` everywhere; `@HttpCode(HttpStatus.NO_CONTENT)` on delete; no
`@UseGuards` and no `@Public()` anywhere in this slice.

Deleting a personal workspace → `ApiException.conflict('Your personal workspace cannot be
deleted')`. Without it a user can delete their only workspace and land in an app with no valid
route.

### 6.5 Migration

One migration — `backend/src/database/migrations/<ts>-AddWorkspacesAndCollections.ts` — not
five. They are one atomic schema unit: `workspaces` without `workspace_members` authorizes
nothing, and `collections` without the backfill leaves every existing user unable to see
anything. Precedent: `AddUsersAndSessions`.

Hand-written raw SQL in the existing style (`CREATE TABLE` / `CREATE INDEX` /
`ALTER TABLE … ADD CONSTRAINT`, then the backfill), `down()` reversing in exact inverse order.
Naming: `PK_<table>`, `IDX_<table>_<cols>`, `UQ_<table>_<cols>`, `FK_<table>_<col>`,
`CHK_<table>_<col>`. It must be hand-written because `migration:generate` cannot express the
composite FKs, the partial unique index, or the backfill.

---

## 7. Frontend files

### 7.1 A new shell, not a modified `AppShell`

[AppShell.tsx](frontend/src/app/AppShell.tsx) is `min-h-screen` + a centered `max-w-3xl` column
that scrolls with the page. The workbench is the opposite layout contract: `h-screen
overflow-hidden`, a fixed sidebar, panes that scroll independently. Two components, neither of
which grows a branch.

```tsx
// frontend/src/app/WorkbenchShell.tsx
<div className="flex h-screen flex-col overflow-hidden bg-slate-50">
  <AppHeader wide />
  <div className="grid min-h-0 flex-1 grid-cols-[280px_1fr]">
    <Sidebar />
    <main className="min-h-0 overflow-auto"><Outlet /></main>
  </div>
</div>
```

⚠️ `min-h-0` on the grid and on `<main>` is load-bearing: a grid/flex child defaults to
`min-height: auto`, so without it the panes size to content and the whole page scrolls — which
looks like a CSS mistake rather than a default.

`AppHeader` gains one optional prop, `wide?: boolean`, swapping `mx-auto max-w-3xl` for
`w-full px-4`. One line, no duplication, `AppShell` unchanged.

### 7.2 Routes — the workspace id lives in the URL

```tsx
// ALL of this sits inside the existing { element: <RequireAuth /> } wrapper —
// the workbench is authenticated like everything else. /login and /register
// stay outside it, unchanged.
{ index: true, element: <WorkspaceRedirect /> },
{ element: <WorkbenchShell />, children: [
    { path: 'w/:workspaceId', element: <EmptyEditorState /> },
    { path: 'w/:workspaceId/requests/:requestId', element: <RequestEditor /> },
]},
{ element: <AppShell />, children: [
    { path: 'tasks', element: <TasksPage /> },
    { path: 'sessions', element: <SessionsPage /> },
]},
{ path: '*', element: <Navigate to="/" replace /> },
```

⚠️ The current router's catch-all lives *inside* `AppShell` and points at `/tasks`
([router.tsx](frontend/src/app/router.tsx)). It must move up a level (it now covers two
shells) and point at `/` — otherwise every mistyped URL still lands on the deprecated
tasks page instead of the workspace redirect.

**URL over a Redux slice**, and the argument is not aesthetic: this codebase has a hard rule
against `localStorage`/`sessionStorage`/`redux-persist`, so a workspace id in Redux does not
survive a reload — every refresh would silently drop the user into "the first workspace", a bug
invisible until someone has two. The URL is the only persistence layer this app allows. It also
gives deep links, working Back, and two tabs on two workspaces for free.

`WorkspaceRedirect` runs `useGetWorkspacesQuery()` and `<Navigate replace>`s to the personal
workspace (falling back to the first), rendering the same "Loading…" as `BootSplash` meanwhile.

`/tasks` and `/sessions` stay exactly as they are. `AppHeader` gains a "Workspace" link to `/`
plus a `WorkspaceSwitcher` — a plain `<select>` that `navigate()`s. Add one sentence to the
README: `/tasks` is the original scaffolding and goes away when the execution slice lands.
Saying it now is what stops it quietly becoming permanent.

### 7.3 The sidebar

```
features/workspaces/  workspacesApi.ts, WorkspaceSwitcher.tsx
features/tree/        treeApi.ts, Sidebar.tsx, CollectionNodeView.tsx,
                      FolderNodeView.tsx (recursive), RequestNodeView.tsx,
                      NodeRow.tsx, NodeMenu.tsx, InlineRename.tsx,
                      MoveToDialog.tsx, useExpanded.ts
```

- **Recursion**: `FolderNodeView` renders its child folders then its requests. Indentation is
  `style={{ paddingLeft: 8 + depth * 14 }}` — an inline style, because Tailwind 4 cannot
  generate `pl-[…]` from a runtime value.
- **No icon library, and this slice should not add one.** Text glyphs, following the precedent
  of `TaskItem.tsx`'s text-only badges: `▸`/`▾` in a `<button aria-expanded>` with the glyph
  `aria-hidden`, `⋯` in a `<button aria-label="More actions">`, and the method name itself as a
  badge using a `Record<HttpMethod, string>` colour map copied from `statusStyles`.
- ⚠️ **`NodeMenu` must be positioned `fixed` from `getBoundingClientRect()`, not `absolute`.**
  The sidebar is an `overflow-y-auto` scroll container, so an absolutely-positioned menu on the
  bottom row is clipped and invisible. This is the most likely piece of visual breakage here.
  Items: Rename · New folder · New request · Move up · Move down · Move to… · Delete. Delete
  uses `window.confirm` for now; say plainly that a real dialog is deferred.
- **`InlineRename`** — one shared component (input with `autoFocus` + `select()`, Enter commits,
  Escape reverts, blur commits), used by all three node types so semantics cannot drift.
- **`useExpanded()`** holds a `Set<string>` in one `useState` **at `Sidebar` level**. Not
  per-node: collapsing a parent unmounts its children, so reopening would reset every
  grandchild. Not Redux: an action dispatch per chevron click. Not `localStorage`: slice 1 does
  not need a persisted second source of truth — it resets on reload, and that is acceptable and
  should be said out loud. Auto-expand the active request's ancestor chain on first load so deep
  links open visible.

### 7.4 The request editor

```
features/requests/  requestsApi.ts, RequestEditor.tsx, RequestUrlBar.tsx,
                    KeyValueEditor.tsx, BodyTab.tsx, AuthTab.tsx, useRequestDraft.ts
features/collections/ collectionsApi.ts    features/folders/ foldersApi.ts
```

Name row → URL bar (`<select>` method + `font-mono` url `<input>` + **Save**) → tab strip →
tab body.

- **No Send button, not even a disabled one.** A disabled Send reads as broken software; an
  absent one reads as an unfinished feature, which is the truth. One comment in
  `RequestUrlBar.tsx` saying so, or the next person "helpfully" adds it.
- **Tabs** are `useState`, not router state — a tab is not a location, and putting it in the URL
  means Back closes a tab instead of leaving the request.
- **`KeyValueEditor`** (shared by Params and Headers): rows of
  `[✓ enabled][key][value][× ]`, plus a permanently-present blank trailing row that materializes
  on the first keystroke. That is Postman's behaviour and it removes the "Add row" button.
- **`BodyTab`**: mode `<select>` plus a plain `<textarea>` (`font-mono text-sm`,
  `spellCheck={false}`). No editor library is installed and adding one is a dependency + bundle
  + theming decision belonging to the Send slice — say so in a comment. Worth ten lines: a
  **Format JSON** button (`JSON.stringify(JSON.parse(text), null, 2)`, parse error shown
  inline), which makes the plain textarea feel deliberate rather than unfinished.
- **`AuthTab`**: type `<select>` plus the inputs that type needs. `type="password"` fields are
  cosmetic only — comment that the value round-trips in plaintext (§1.6).
- ⚠️ **`useRequestDraft` must key its seeding `useEffect` on `request?.id`, never on `request`.**
  Depending on the object re-seeds the draft on every background refetch and wipes whatever the
  user was typing — the worst bug available in this pane, because it is intermittent and
  presents as a dropped keystroke. The save response is written back explicitly instead.
  Ctrl/Cmd+S saves; `useBlocker` + `window.confirm` guards navigation away (a labelled
  placeholder). **No autosave** — autosave plus a tree that invalidates on renames is a refetch
  storm.

### 7.5 RTK Query

```ts
tagTypes: ['Task', 'Session', 'Me', 'Workspace', 'Tree', 'Request'],
```

**Deliberately no `Collection` or `Folder` tag** — neither has a read endpoint in this slice;
they exist only inside the tree, and a tag nothing provides is dead weight that looks like
coverage. **No `Environment` tag either, by the same rule**: this slice builds no
`environmentsApi` and no environment UI (§1.6), so nothing would provide or invalidate it.
It arrives with the slice that consumes it.

- `getTree(workspaceId)` provides `[{ type: 'Tree', id: workspaceId }]`.
- Every collection/folder mutation, and request create/delete/move, invalidates that tag.
- `getRequest(id)` provides `[{ type: 'Request', id }]`.
- ⚠️ `updateRequest` invalidates `Request:id` always, and `Tree:workspaceId` **only when `name`
  or `method` is in the patch** — the sidebar renders nothing else, and invalidating on every
  save refetches the whole tree each time someone edits a header.

**One `Tree` tag per workspace, not per collection**: the tree is one HTTP response, so a
per-collection tag could never cause a *partial* refetch, and a move between collections would
force the client to know both collection ids. Per-workspace is exactly as precise as the
transport allows and strictly simpler.

⚠️ **Every mutation argument must carry `workspaceId` even though the server does not need it** —
it is the invalidation key and there is no other way to reach it from a mutation. This is the
thing an implementer forgets; the symptom is "the sidebar doesn't update until I reload", which
reads as a caching bug rather than a missing field.

**One optimistic update, and only one: inline rename**, via
`treeApi.util.updateQueryData('getTree', workspaceId, …)` with `patchResult.undo()` in the
catch. Rename is the only operation where the round trip is a visible flicker on the exact
element the user is looking at. Everything else refetches — do not gold-plate.

---

## 8. Verification

### Automated

**Unit** (`cd backend && yarn test`), colocated `.spec.ts`:

| file | what it pins |
|---|---|
| `common/ordering.spec.ts` | empty / append / prepend (a negative result is legal) / between / `'reindex'` when the gap is 1 / index clamped |
| `workspaces/provision-personal-workspace.spec.ts` | one workspace + one `OWNER` row, `isPersonal: true`, and **both writes go through the *passed* manager** — this is what catches "opened its own connection and escaped the transaction" |
| `workspaces/workspace-scope.spec.ts` | roles are bound as a parameter, never interpolated into SQL — both fragments (`SCOPED_COLLECTION_IDS`, `SCOPED_WORKSPACE_IDS`) |
| `collections/build-tree.spec.ts` | nesting; folders before requests; the `position, createdAt, id` tiebreak; an orphan attaches to root and is **not dropped**; empty → `collections: []` |
| `collections/folders.service.spec.ts` | move into own descendant rejected; legal move succeeds |
| `requests/requests.service.spec.ts` | mirrors `tasks.service.spec.ts`; `affected === 0` → `explainDenial`; create runs the §2.0 scoped parent resolve on the **body's** `collectionId`, and its denial keys on the parent (403 when readable, 404 when invisible) |
| `requests/dto/request-response.dto.spec.ts` | jsonb survives `excludeExtraneousValues`; unexposed columns are dropped |
| `auth/auth.service.spec.ts` (edit) | `register` still throws `EMAIL_TAKEN` when the 23505 is raised **from inside the transaction** |

**e2e** — `backend/test/workspaces.e2e-spec.ts`, following
[register.e2e-spec.ts](backend/test/register.e2e-spec.ts) exactly: `e2e-workspace-` email prefix
with the same `runId` suffix; `afterAll` deletes by that prefix and **everything else follows by
`ON DELETE CASCADE`** (a design consequence of §1, not luck — comment it); `THROTTLER_OPTIONS`
overridden via the provider token, not `process.env`; cookie name from `ConfigService`.
⚠️ It must never touch the seed user.

1. Register → `GET /workspaces` → exactly one, `isPersonal: true`, `role: 'OWNER'`,
   `organizationId: null`.
2. Empty tree → `200 { workspaceId, collections: [] }`, and assert there is **no `meta` key** —
   pins §4's single-resource decision against a future "consistency" fix.
3. Build collection → folder → nested folder → request at each level; assert nesting and
   folders-before-requests.
4. **Cross-tenant isolation.** User B against user A's ids: `GET`/`PATCH`/`DELETE /requests/:id`
   → 404; `GET /workspaces/:aId/tree` → 404; **`POST /requests` with A's `collectionId` → 404**
   (the case a route-param guard would pass — the most important assertion in the file);
   `PATCH /requests/:bId/move` targeting A's `folderId` → 404. For that last one to be
   deterministic, the move handler must resolve the **target** folder through the scoped
   query *before* the same-collection check — an unscoped resolve would hit the
   same-collection 404/409 first and the assertion would pass for the wrong reason.
5. **Role seam.** Insert a `VIEWER` membership by raw `dataSource.query`: `GET /tree` → 200,
   `PATCH /requests/:id` → 403 `FORBIDDEN`, `POST /requests` → 403.
6. **Move.** Root → folder → back. Two sequential moves land in order. Folder into its own
   descendant → 409.
7. **Cascade.** `DELETE /collections/:id` → 204, then a *direct* `SELECT count(*)` on `requests`
   and `folders` → 0. Going past the API is the point; the API would filter them out either way.
8. Personal workspace undeletable → 409.
9. Validation: `method: 'BREW'` → 400; `body: { mode: 'nonsense' }` → 400 naming `body`; unknown
   property → 400.

Then `cd backend && yarn lint` (note: `eslint --fix`, it rewrites files) and
`cd frontend && yarn lint && yarn build`.

### Manual (`./dev.sh`, http://localhost:5173, seed user `rashiqrahaman@yahoo.com` / `Password123!`)

0. **Before the browser** — run §5.1's verification query. It must return 0.
1. `/` → one `GET /workspaces` → redirect to `/w/<uuid>`, sidebar shows an empty state, not a
   spinner that never resolves.
2. Register a new account in a private window → lands in its own empty workspace. Exactly one
   workspace. (The provisioning transaction, end to end.)
3. Create collection → folder → nested folder → request at each level. Every node appears
   **without a manual reload** (proves `Tree` invalidation).
4. Inline-rename a request: the label updates before the network settles and stays updated.
   Escape mid-rename reverts.
5. Collapse a parent and reopen it — grandchildren keep their expansion (proves the `Set` lives
   at `Sidebar`).
6. Scroll the sidebar so the last node is at the very bottom, open its kebab — fully visible,
   not clipped.
7. Set method `POST`, a URL, two headers, a JSON body, bearer auth → Save → hard reload →
   everything present, and the sidebar badge now reads `POST`.
8. Type in the URL without saving, click another request → the unsaved-changes prompt fires;
   Cancel keeps you put with the text intact.
9. **The refetch-wipes-typing trap**: start typing in the body, then trigger a background
   refetch (tab away and back). The text must survive.
10. **Save does not refetch the tree**: edit only a header → Save → **no** `GET …/tree` in
    Network. Then rename and Save → exactly one.
11. "Move to…" a request into another folder; "Move up" twice moves two places, not one.
12. Delete a folder containing requests → the whole subtree disappears; if it held the open
    request, the pane falls back to the empty state rather than showing a stale one.
13. Copy a request id from account A, sign in as B in a private window, visit
    `/w/<Bworkspace>/requests/<Aid>` → a not-found state, not someone else's request.
14. `/tasks` and `/sessions` still work and still look centered at `max-w-3xl`.

---

## 9. Build order

1. `packages/contracts/src/{workspace,collection,request,environment,tree}.ts` + `index.ts`
2. **`./dev.sh contracts`** — nothing else compiles until this runs
3. The migration → `yarn migration:run` → the backfill verification query
4. Six entities + `forFeature` registrations → `yarn build`, then confirm
   `yarn migration:generate` produces an **empty** migration (proof the entities match the SQL)
5. `common/ordering.ts`, `workspace-scope.ts`, `provision-personal-workspace.ts` + their specs
6. `UsersService.create` transaction + the `auth.service.spec.ts` addition — **verify with one
   manual signup before going further**
7. Services: workspaces → collections → folders → requests → environments → `build-tree` + tree
8. DTOs → controllers → modules → `app.module.ts`
9. Unit specs, then `workspaces.e2e-spec.ts`
10. Frontend: `baseApi` tagTypes → `workspacesApi` + `WorkspaceRedirect` (**app still works
    unchanged here**) → `WorkbenchShell` + router + `AppHeader wide` → `treeApi` + a read-only
    `Sidebar` (**first visible milestone**) → menu / rename / create / delete → move →
    `requestsApi` + `RequestEditor` + tabs → `useRequestDraft` + save
11. Docs, in the same change: README (the new routes, the `/tree` single-resource note, the
    plaintext-secrets gap, the `/tasks` deprecation sentence) and CLAUDE.md (a "Domain and
    tenancy" section: the SQL-scoping rule, 404-vs-403, the provisioning transaction,
    `workspace-scope.ts` being plain functions, and the `Tree` tag strategy). This repo's
    convention is that docs land with the feature.

---

## 10. Known traps

1. ⚠️ **`./dev.sh contracts` after every contracts edit.** Copied, not symlinked. Skip it and
   both sides compile against a stale `dist/`, every `implements <Contract>` silently stops
   guarding anything, and errors point into `node_modules`. This slice edits contracts six times.
2. ⚠️ **Authorization in a guard instead of in SQL** (§2.1). Looks complete, passes every hand
   test, leaves `POST /requests` and every move destination unauthorized. e2e case 4 catches it.
3. ⚠️ **Provisioning outside the user-creation transaction** (§5). A silently broken account
   with no repair path.
4. ⚠️ **`migration:generate` churn**: name every index in the entity; `varchar` not
   `type: 'enum'`; jsonb defaults as `default: () => "'[]'::jsonb"`, not `default: []`.
5. ⚠️ **The composite FK relies on `MATCH SIMPLE`** (§1.5). "Tightening" it to `MATCH FULL`
   forbids every root-level request.
6. ⚠️ **Folder move cycles** (§3.1). The FK does not catch them; the subtree orphans itself and
   becomes invisible and undeletable.
7. ⚠️ **`= NULL` in the sibling query** (§3.1). Use `IS NOT DISTINCT FROM`.
8. ⚠️ **Draft re-seeding wipes typing** (§7.4). Key on `request?.id`.
9. ⚠️ **Invalidating `Tree` on every request save** (§7.5). Gate it on `name`/`method`.
10. ⚠️ **Kebab menu clipped by the sidebar's `overflow-y-auto`** (§7.3). Use `position: fixed`.
11. ⚠️ **`min-h-0` in the workbench grid** (§7.1).
12. ⚠️ **Do not name the request contract `Request`** — DOM and Express collision. `ApiRequest`.
13. ⚠️ **Nested jsonb DTO classes silently strip keys under `whitelist: true`** (§6.3). Use a
    single custom constraint per union.
14. ⚠️ **`workspaces.ownerUserId ON DELETE CASCADE`** is right today and wrong the moment sharing
    lands (§1.1) — and it is what makes e2e cleanup work, so changing it is a paired change.
15. ⚠️ **Secrets are plaintext** (§1.6). Must reach the README in this change.
16. ⚠️ **e2e runs against the dev database.** Clean up only by the `e2e-workspace-` prefix; never
    widen it; never touch the seed user; keep `--runInBand`.
17. **`yarn lint` in `backend/` is `eslint --fix`** — it rewrites files, and leaves ~15
    pre-existing unfixable errors. A red lint is not necessarily your change.
18. ⚠️ **The scoped-UPDATE pattern does not cover `POST`** (§2.0). Every create must do the
    scoped parent resolve inside its transaction, with the FK as the race backstop and the
    parent-keyed denial helper — `explainDenial` cannot be reused (no row id exists yet).
    Copying the update pattern's shape onto create is exactly how the §2.1-point-2 bug ships.
19. **A tag nothing provides is dead weight** — no `Collection`, `Folder` *or* `Environment`
    tag in this slice (§7.5). Adding one "for completeness" makes the cache look covered
    where it is not.
