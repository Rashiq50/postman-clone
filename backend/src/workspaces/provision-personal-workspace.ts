import { WorkspaceRole } from '@raven/contracts';
import type { EntityManager } from 'typeorm';
import { WorkspaceMemberEntity } from './entities/workspace-member.entity';
import { WorkspaceEntity } from './entities/workspace.entity';

/**
 * The literal is duplicated in the migration's backfill on purpose: a migration
 * must keep producing the same result forever, so it does not import
 * application code. Changing this name changes it for new users only.
 */
export const PERSONAL_WORKSPACE_NAME = 'My Workspace';

/**
 * Creates a user's personal workspace and the OWNER membership that goes with
 * it. **The only place either is written**, which is what keeps
 * `workspaces.ownerUserId` and the OWNER row — two views of one fact —
 * consistent without a trigger.
 *
 * A **plain function taking the caller's `EntityManager`**, not an
 * `@Injectable()`. A service holds a `Repository` bound to the *default*
 * manager, so enlisting in a caller's transaction would mean taking a manager
 * argument anyway — at which point injection buys nothing and only adds a
 * `UsersModule → WorkspacesModule` edge. Same precedent as `refresh-cookie.ts`.
 *
 * It must run **inside the transaction that creates the user**. A user row with
 * no workspace is a silently and permanently broken account: registration still
 * returns 201 with a working token, `GET /workspaces` comes back empty, the
 * workbench has nothing to show, and no endpoint repairs it.
 *
 * ⚠️ `UQ_workspaces_personal_owner` makes a *second* personal workspace for the
 * same user a 23505 as well. On the registration path that cannot happen — the
 * user row is brand new — but it matters because `AuthService.register` maps
 * any 23505 to `EMAIL_TAKEN`, so a second call site would report a wrong and
 * very confusing error. Any future caller must handle that itself.
 */
export async function provisionPersonalWorkspace(
  manager: EntityManager,
  userId: string,
): Promise<WorkspaceEntity> {
  const workspace = await manager.save(
    manager.create(WorkspaceEntity, {
      owner: { id: userId },
      name: PERSONAL_WORKSPACE_NAME,
      isPersonal: true,
      // Explicit rather than left to the column default: this is the
      // organization seam, and "personal, no org" is a statement worth making
      // at the one place a workspace is born.
      organizationId: null,
    }),
  );

  await manager.save(
    manager.create(WorkspaceMemberEntity, {
      workspace: { id: workspace.id },
      user: { id: userId },
      role: WorkspaceRole.OWNER,
    }),
  );

  return workspace;
}
