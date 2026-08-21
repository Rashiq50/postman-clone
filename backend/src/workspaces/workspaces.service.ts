import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WorkspaceRole, type Paginated } from '@raven/contracts';
import { Repository } from 'typeorm';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { ApiException } from '../common/errors/api.exception';
import { paginated } from '../common/pagination';
import { WorkspaceEntity } from './entities/workspace.entity';
import { explainDenial } from './scope-denial';
import {
  ADMIN_ROLES,
  OWNER_ROLES,
  READ_ROLES,
  SCOPED_WORKSPACE_IDS,
  WORKSPACE_SCOPE,
  scopeParams,
  scopedWhere,
} from './workspace-scope';

/**
 * A workspace joined with the caller's own role in it. `role` is not a property
 * of the workspace — it is the answer to "what may *you* do here" — but it
 * travels on the wire so the UI can disable buttons without a second request.
 */
export type WorkspaceWithRole = WorkspaceEntity & {
  role: WorkspaceRole;
  activeEnvironmentId: string | null;
};

/** Columns of the joined read. Kept in one place so the two readers agree. */
const WORKSPACE_SELECT = [
  'w."id" AS "id"',
  'w."organizationId" AS "organizationId"',
  'w."ownerUserId" AS "ownerUserId"',
  'w."name" AS "name"',
  'w."isPersonal" AS "isPersonal"',
  'w."createdAt" AS "createdAt"',
  'w."updatedAt" AS "updatedAt"',
  'm."role" AS "role"',
  // Rides beside `role`, and is the same kind of field: the caller's own
  // preference, joined from `workspace_members`, not a column on `workspaces`.
  // Both readers get it for free — this constant exists so they cannot drift.
  'm."activeEnvironmentId" AS "activeEnvironmentId"',
];

@Injectable()
export class WorkspacesService {
  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaces: Repository<WorkspaceEntity>,
  ) {}

  /**
   * Every workspace the caller is a member of — which today is exactly their
   * own personal one, and tomorrow is however many they have been invited to.
   * The membership JOIN *is* the filter, so there is no separate check.
   */
  async findAll(
    userId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<WorkspaceWithRole>> {
    const { page, limit } = query;

    const base = this.workspaces
      .createQueryBuilder('w')
      .innerJoin(
        'workspace_members',
        'm',
        'm."workspaceId" = w."id" AND m."userId" = :userId AND m."role" = ANY(:roles)',
        scopeParams(userId, READ_ROLES),
      );

    const total = await base.clone().getCount();

    const rows = await base
      .select(WORKSPACE_SELECT)
      // Personal first so `WorkspaceRedirect` can take row 0 without a second
      // pass, then stable by name for a list a human has to scan.
      .orderBy('w."isPersonal"', 'DESC')
      .addOrderBy('w."name"', 'ASC')
      .addOrderBy('w."id"', 'ASC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany<WorkspaceWithRole>();

    return paginated(rows, total, page, limit);
  }

  async findOne(userId: string, id: string): Promise<WorkspaceWithRole> {
    const row = await this.workspaces
      .createQueryBuilder('w')
      .innerJoin(
        'workspace_members',
        'm',
        'm."workspaceId" = w."id" AND m."userId" = :userId AND m."role" = ANY(:roles)',
        scopeParams(userId, READ_ROLES),
      )
      .select(WORKSPACE_SELECT)
      .where('w."id" = :id', { id })
      .getRawOne<WorkspaceWithRole>();

    if (!row) {
      // Not a member and non-existent are the same answer on purpose — see
      // `explainDenial`. There is no role low enough to be denied a read, so
      // this branch cannot be a 403.
      return explainDenial(
        this.workspaces.manager,
        WorkspaceEntity,
        WORKSPACE_SCOPE,
        userId,
        id,
      );
    }
    return row;
  }

  /**
   * A workspace the caller creates is a shared one — `isPersonal` is false and
   * unsettable from the wire. The personal workspace is born exactly once, in
   * `provisionPersonalWorkspace`, inside the user-creation transaction.
   */
  async create(userId: string, name: string): Promise<WorkspaceWithRole> {
    const id = await this.workspaces.manager.transaction(async (manager) => {
      const workspace = await manager.save(
        manager.create(WorkspaceEntity, {
          owner: { id: userId },
          name,
          isPersonal: false,
          organizationId: null,
        }),
      );
      // `ownerUserId` and the OWNER row are two views of one fact, written
      // together — the same invariant `provisionPersonalWorkspace` keeps.
      await manager.query(
        `INSERT INTO "workspace_members" ("workspaceId", "userId", "role") VALUES ($1, $2, $3)`,
        [workspace.id, userId, WorkspaceRole.OWNER],
      );
      return workspace.id;
    });

    return this.findOne(userId, id);
  }

  /** Renaming is an administrative act: OWNER or ADMIN, never EDITOR. */
  async update(
    userId: string,
    id: string,
    changes: { name?: string },
  ): Promise<WorkspaceWithRole> {
    if (Object.keys(changes).length === 0) return this.findOne(userId, id);

    const result = await this.workspaces
      .createQueryBuilder()
      .update(WorkspaceEntity)
      .set(changes)
      .where(`"id" = :id AND ${scopedWhere(WORKSPACE_SCOPE)}`, {
        id,
        ...scopeParams(userId, ADMIN_ROLES),
      })
      .execute();

    if (!result.affected) {
      await explainDenial(
        this.workspaces.manager,
        WorkspaceEntity,
        WORKSPACE_SCOPE,
        userId,
        id,
      );
    }
    return this.findOne(userId, id);
  }

  /** Deleting is OWNER-only, and a personal workspace cannot be deleted at all. */
  async remove(userId: string, id: string): Promise<void> {
    // Checked before the delete rather than folded into its WHERE, because the
    // two failures need different answers: a personal workspace must say why
    // (409), while a workspace that is not yours must stay a 404. A single
    // statement could only produce one of those.
    //
    // Without this a user can delete their only workspace and land in an app
    // with no valid route to redirect to.
    const personal = await this.workspaces
      .createQueryBuilder('w')
      .where(
        `w."id" = :id AND w."isPersonal" AND ${scopedWhere(WORKSPACE_SCOPE, 'w')}`,
        { id, ...scopeParams(userId, READ_ROLES) },
      )
      .getExists();

    if (personal) {
      throw ApiException.conflict('Your personal workspace cannot be deleted');
    }

    const result = await this.workspaces
      .createQueryBuilder()
      .delete()
      .from(WorkspaceEntity)
      .where(`"id" = :id AND ${scopedWhere(WORKSPACE_SCOPE)}`, {
        id,
        ...scopeParams(userId, OWNER_ROLES),
      })
      .execute();

    if (!result.affected) {
      await explainDenial(
        this.workspaces.manager,
        WorkspaceEntity,
        WORKSPACE_SCOPE,
        userId,
        id,
      );
    }
  }

  /**
   * Sets the caller's active environment in a workspace.
   *
   * ⚠️ **The `UPDATE` is keyed on `("workspaceId","userId")`, not on a row
   * id** — an unusual shape for this codebase, and the reason it is spelled
   * out: copying the `"id" = :id` form from every other service here would
   * rewrite *every member's* preference in the workspace.
   */
  async setActiveEnvironment(
    userId: string,
    workspaceId: string,
    environmentId: string | null,
  ): Promise<WorkspaceWithRole> {
    if (environmentId !== null) {
      // Reached in raw SQL rather than by importing `EnvironmentsModule`. The
      // precedent is `RequestsService.assertFolderInCollection`: **nothing
      // imports `WorkspacesModule` and `WorkspacesModule` gains no imports.**
      const rows: unknown[] = await this.workspaces.manager.query(
        `SELECT 1 FROM "environments" WHERE "id" = $1 AND "workspaceId" = $2`,
        [environmentId, workspaceId],
      );
      if (rows.length === 0) {
        throw new NotFoundException(
          `Environment with id "${environmentId}" not found in this workspace`,
        );
      }
    }

    const result = await this.workspaces.manager.query(
      `UPDATE "workspace_members" SET "activeEnvironmentId" = $1, "updatedAt" = now()
       WHERE "workspaceId" = $2 AND "userId" = $3 AND "role" = ANY($4)`,
      // READ_ROLES: it is the caller's own preference row, and a VIEWER is
      // entitled to one.
      [environmentId, workspaceId, userId, [...READ_ROLES]],
    );

    const affected = Array.isArray(result) ? Number(result[1] ?? 0) : 0;
    if (!affected) {
      await explainDenial(
        this.workspaces.manager,
        WorkspaceEntity,
        WORKSPACE_SCOPE,
        userId,
        workspaceId,
      );
    }

    return this.findOne(userId, workspaceId);
  }

  /**
   * Asserts the caller reaches `workspaceId` with one of `roles`, and returns
   * it. The create path for collections and environments — there is no row to
   * scope yet, so the parent is resolved instead (see `explainParentDenial`).
   */
  async assertWorkspaceScope(
    userId: string,
    workspaceId: string,
    roles: readonly WorkspaceRole[],
  ): Promise<string> {
    const found = await this.workspaces
      .createQueryBuilder('w')
      .where(`w."id" = :id AND w."id" IN (${SCOPED_WORKSPACE_IDS})`, {
        id: workspaceId,
        ...scopeParams(userId, roles),
      })
      .getExists();

    if (!found) {
      await explainDenial(
        this.workspaces.manager,
        WorkspaceEntity,
        WORKSPACE_SCOPE,
        userId,
        workspaceId,
      );
    }
    return workspaceId;
  }
}
