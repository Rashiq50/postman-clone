import { WorkspaceRole } from '@postman-clone/contracts';

/**
 * Authorization, as SQL fragments rather than a guard.
 *
 * **The rule: membership travels inside the statement that reads or writes.**
 * Instead of a single-owner `WHERE "ownerId" = :ownerId` it is
 * `WHERE "collectionId" IN (<collections I can write to>)`. A row belonging to
 * someone else is never materialized, and there is no interval between
 * checking and acting.
 *
 * A `@WorkspaceMember(EDITOR)` guard was the obvious alternative and is wrong
 * in four separate ways, none of them stylistic:
 *
 * 1. **TOCTOU.** The guard resolves membership, the service then trusts it and
 *    writes. In between, the membership row can be deleted or the row moved.
 * 2. **It cannot see `POST`.** On `POST /requests` the parent id is in the
 *    *body*, not in `:id`, so a guard keyed on route params silently permits
 *    creating a request inside a stranger's collection — a full cross-tenant
 *    write, and the single most likely bug in this feature.
 * 3. **It cannot see `move`.** `PATCH /requests/:id/move` has *two* parents; a
 *    guard on `:id` authorizes the source and waves the destination through.
 * 4. **It is the same JOIN, run twice.** The service either repeats it — which
 *    saves nothing — or trusts it, which is (1).
 *
 * Stated in one line: such a guard looks complete, passes every hand test, and
 * leaves `POST /requests` and every move destination unauthorized.
 *
 * These are **plain exported constants, not an `@Injectable()`**. Same
 * reasoning already recorded for `auth/refresh-cookie.ts`: a provider would
 * force `CollectionsModule → WorkspacesModule` and `RequestsModule →
 * WorkspacesModule` edges that buy nothing, and a service holding a
 * `Repository` bound to the default manager cannot enlist in a caller's
 * transaction anyway.
 */

/** Can change content: collections, folders, requests, environments. */
export const WRITE_ROLES = [
  WorkspaceRole.OWNER,
  WorkspaceRole.ADMIN,
  WorkspaceRole.EDITOR,
] as const;

/** Can see the workspace at all. Everyone who is a member. */
export const READ_ROLES = [
  WorkspaceRole.OWNER,
  WorkspaceRole.ADMIN,
  WorkspaceRole.EDITOR,
  WorkspaceRole.VIEWER,
] as const;

/** Can administer the workspace itself — rename it, and later manage members. */
export const ADMIN_ROLES = [WorkspaceRole.OWNER, WorkspaceRole.ADMIN] as const;

/** Can delete the workspace or transfer it. A singleton, deliberately. */
export const OWNER_ROLES = [WorkspaceRole.OWNER] as const;

/**
 * Collection ids inside a workspace the caller holds one of `:roles` in.
 *
 * ⚠️ Roles are bound as an **array parameter** (`= ANY(:roles)`), never
 * interpolated into the string. Role checks live nowhere but that argument —
 * there is no `if (role === 'VIEWER') throw` anywhere in the codebase, and
 * adding a role is editing one array.
 */
export const SCOPED_COLLECTION_IDS = `
  SELECT c."id" FROM "collections" c
  JOIN "workspace_members" m ON m."workspaceId" = c."workspaceId"
  WHERE m."userId" = :userId AND m."role" = ANY(:roles)
`;

/**
 * Workspace ids the caller holds one of `:roles` in — the workspace-level
 * sibling of `SCOPED_COLLECTION_IDS`.
 *
 * `PATCH`/`DELETE /workspaces/:id` and the environments endpoints scope on
 * membership directly, because there is no collection anywhere in the chain.
 * It exists as a shared fragment rather than an improvised JOIN in each service
 * so that the role table — manage = `ADMIN_ROLES`, delete = `OWNER_ROLES` —
 * connects to actual queries through this fragment's `roles` argument, and the
 * "roles live nowhere but the array" rule stays true.
 */
export const SCOPED_WORKSPACE_IDS = `
  SELECT m."workspaceId" FROM "workspace_members" m
  WHERE m."userId" = :userId AND m."role" = ANY(:roles)
`;

/** Parameters both fragments bind. `roles` is spread so the readonly tuples above fit. */
export function scopeParams(
  userId: string,
  roles: readonly WorkspaceRole[],
): { userId: string; roles: WorkspaceRole[] } {
  return { userId, roles: [...roles] };
}

/**
 * How a table reaches `workspace_members`.
 *
 * `collection` — via its own `collectionId` (folders, requests).
 * `workspace`  — via its own `workspaceId` (collections, environments).
 * `self`       — the row *is* the workspace.
 */
export type ScopeVia = 'collection' | 'workspace' | 'self';

export interface ScopedResource {
  /** Only used in error messages; the query builder supplies the real table. */
  readonly resourceName: string;
  readonly via: ScopeVia;
}

export const REQUEST_SCOPE: ScopedResource = {
  resourceName: 'Request',
  via: 'collection',
};
export const FOLDER_SCOPE: ScopedResource = {
  resourceName: 'Folder',
  via: 'collection',
};
export const COLLECTION_SCOPE: ScopedResource = {
  resourceName: 'Collection',
  via: 'workspace',
};
export const ENVIRONMENT_SCOPE: ScopedResource = {
  resourceName: 'Environment',
  via: 'workspace',
};
export const WORKSPACE_SCOPE: ScopedResource = {
  resourceName: 'Workspace',
  via: 'self',
};

/**
 * The membership predicate for a resource, as a SQL string.
 *
 * Used by **both** the hot-path statement and the failure-path visibility
 * check, which is the point: if the two ever disagreed, a row could be
 * unwritable but reported as non-existent, or worse. One definition, two
 * callers, no drift.
 *
 * `alias` is empty for `UPDATE`/`DELETE` — TypeORM emits those without a table
 * alias, so a prefixed column name is a syntax error there.
 */
export function scopedWhere(scope: ScopedResource, alias = ''): string {
  const prefix = alias ? `${alias}.` : '';
  switch (scope.via) {
    case 'collection':
      return `${prefix}"collectionId" IN (${SCOPED_COLLECTION_IDS})`;
    case 'workspace':
      return `${prefix}"workspaceId" IN (${SCOPED_WORKSPACE_IDS})`;
    case 'self':
      return `${prefix}"id" IN (${SCOPED_WORKSPACE_IDS})`;
  }
}
