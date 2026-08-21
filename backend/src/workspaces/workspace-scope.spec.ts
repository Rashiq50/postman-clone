import { WorkspaceRole } from '@postman-clone/contracts';
import {
  ADMIN_ROLES,
  COLLECTION_SCOPE,
  OWNER_ROLES,
  READ_ROLES,
  REQUEST_EXECUTION_SCOPE,
  REQUEST_SCOPE,
  SCOPED_COLLECTION_IDS,
  SCOPED_WORKSPACE_IDS,
  WORKSPACE_SCOPE,
  WRITE_ROLES,
  scopeParams,
  scopedWhere,
} from './workspace-scope';

const FRAGMENTS = {
  SCOPED_COLLECTION_IDS,
  SCOPED_WORKSPACE_IDS,
};

describe('workspace scope fragments', () => {
  describe.each(Object.entries(FRAGMENTS))('%s', (_name, fragment) => {
    it('binds roles as a parameter rather than interpolating them', () => {
      // The whole point of the fragment. If a role name ever appears as a
      // literal here, someone has started building the WHERE clause by string
      // concatenation and the next step is a SQL injection.
      expect(fragment).toContain('= ANY(:roles)');
      for (const role of Object.values(WorkspaceRole)) {
        expect(fragment).not.toContain(`'${role}'`);
      }
    });

    it('binds the caller id as a parameter', () => {
      expect(fragment).toContain('m."userId" = :userId');
    });

    it('is a bare SELECT, usable as a subquery', () => {
      expect(fragment.trim().startsWith('SELECT')).toBe(true);
      expect(fragment).not.toContain(';');
    });
  });

  it('scopes collections through workspace_members, never through an owner column', () => {
    // A `collections.ownerId` shortcut would authorize the creator only and
    // silently exclude every other member of a shared workspace.
    expect(SCOPED_COLLECTION_IDS).toContain(
      'JOIN "workspace_members" m ON m."workspaceId" = c."workspaceId"',
    );
  });
});

describe('role sets', () => {
  it('lets every member read', () => {
    expect([...READ_ROLES].sort()).toEqual(
      [...Object.values(WorkspaceRole)].sort(),
    );
  });

  it('excludes VIEWER from writing', () => {
    expect(WRITE_ROLES).not.toContain(WorkspaceRole.VIEWER);
    expect(READ_ROLES).toContain(WorkspaceRole.VIEWER);
  });

  it('excludes EDITOR from administering, and everyone but OWNER from deleting', () => {
    expect(ADMIN_ROLES).not.toContain(WorkspaceRole.EDITOR);
    expect(OWNER_ROLES).toEqual([WorkspaceRole.OWNER]);
  });

  it('nests: owner ⊂ admin ⊂ write ⊂ read', () => {
    expect(WRITE_ROLES).toEqual(expect.arrayContaining([...ADMIN_ROLES]));
    expect(ADMIN_ROLES).toEqual(expect.arrayContaining([...OWNER_ROLES]));
    expect(READ_ROLES).toEqual(expect.arrayContaining([...WRITE_ROLES]));
  });
});

describe('scopeParams', () => {
  it('produces a mutable array, so TypeORM can bind the readonly role tuples', () => {
    const params = scopeParams('user-1', WRITE_ROLES);
    expect(params).toEqual({
      userId: 'user-1',
      roles: ['OWNER', 'ADMIN', 'EDITOR'],
    });
    expect(Array.isArray(params.roles)).toBe(true);
  });
});

describe('scopedWhere', () => {
  it.each([
    [COLLECTION_SCOPE, '"workspaceId" IN'],
    [REQUEST_SCOPE, '"collectionId" IN'],
    [WORKSPACE_SCOPE, '"id" IN'],
    [REQUEST_EXECUTION_SCOPE, '"requestId" IN'],
  ])('keys $resourceName on %s', (scope, column) => {
    expect(scopedWhere(scope)).toContain(column);
  });

  it('prefixes with the alias when one is given, and omits it when not', () => {
    // ⚠️ TypeORM emits UPDATE/DELETE without a table alias, so a prefixed
    // column name is a syntax error there.
    expect(scopedWhere(REQUEST_SCOPE, 'r')).toContain('r."collectionId"');
    expect(scopedWhere(REQUEST_SCOPE)).toContain('"collectionId" IN');
    expect(scopedWhere(REQUEST_SCOPE)).not.toContain('r."collectionId"');
  });

  it('reaches membership for an execution through its request, with no denormalized workspaceId', () => {
    // A `request_executions.workspaceId` column would be a second copy of the
    // tenancy fact, free to drift from the collection the request lives in.
    const fragment = scopedWhere(REQUEST_EXECUTION_SCOPE, 'e');

    expect(fragment).toContain('e."requestId" IN');
    expect(fragment).toContain('FROM "requests" r');
    expect(fragment).toContain(SCOPED_COLLECTION_IDS.trim());
    expect(fragment).not.toContain('e."workspaceId"');
  });

  it('binds roles as a parameter in every scope, including the new one', () => {
    for (const scope of [
      COLLECTION_SCOPE,
      REQUEST_SCOPE,
      WORKSPACE_SCOPE,
      REQUEST_EXECUTION_SCOPE,
    ]) {
      const fragment = scopedWhere(scope, 't');
      expect(fragment).toContain('= ANY(:roles)');
      for (const role of Object.values(WorkspaceRole)) {
        expect(fragment).not.toContain(`'${role}'`);
      }
    }
  });
});
