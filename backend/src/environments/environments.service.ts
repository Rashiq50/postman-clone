import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  CreateEnvironmentInput,
  Paginated,
  UpdateEnvironmentInput,
} from '@raven/contracts';
import { Repository } from 'typeorm';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { paginated } from '../common/pagination';
import { appendPosition } from '../common/sibling-positions';
import { WorkspaceEntity } from '../workspaces/entities/workspace.entity';
import { explainDenial, explainParentDenial } from '../workspaces/scope-denial';
import {
  ENVIRONMENT_SCOPE,
  READ_ROLES,
  SCOPED_WORKSPACE_IDS,
  WORKSPACE_SCOPE,
  WRITE_ROLES,
  scopeParams,
  scopedWhere,
} from '../workspaces/workspace-scope';
import { EnvironmentEntity } from './entities/environment.entity';

/**
 * CRUD for environments. The table and these endpoints exist so the domain
 * model is complete and so nothing has to be retrofitted later; **no UI
 * consumes them in this slice** — an environment editor without `{{var}}`
 * interpolation would be a form with no observable effect, so it ships with
 * execution.
 *
 * There is deliberately no reorder endpoint: `position` is assigned on create
 * and nothing renders environments in an order a user can drag. It exists so
 * the column is not retrofitted onto a populated table later.
 */
@Injectable()
export class EnvironmentsService {
  constructor(
    @InjectRepository(EnvironmentEntity)
    private readonly environments: Repository<EnvironmentEntity>,
  ) {}

  /**
   * Nested under the workspace, because a workspace id is not derivable from
   * anything else — unlike a collection or folder id, which identify their own
   * parents. Create stays flat with the id in the body, like every other
   * resource here.
   */
  async findAllInWorkspace(
    userId: string,
    workspaceId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<EnvironmentEntity>> {
    const { page, limit } = query;

    const [rows, total] = await this.environments
      .createQueryBuilder('e')
      .where(
        `e."workspaceId" = :workspaceId AND ${scopedWhere(ENVIRONMENT_SCOPE, 'e')}`,
        { workspaceId, ...scopeParams(userId, READ_ROLES) },
      )
      .orderBy('e."position"', 'ASC')
      .addOrderBy('e."createdAt"', 'ASC')
      .addOrderBy('e."id"', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    // An empty page is ambiguous — no environments, or no such workspace — so
    // the workspace is confirmed only in that case, and only to pick the right
    // status. A member with zero environments still gets an empty list.
    if (total === 0) {
      await this.assertWorkspaceVisible(userId, workspaceId);
    }

    return paginated(rows, total, page, limit);
  }

  /** See the create-path note on `CollectionsService.create` — same shape. */
  async create(
    userId: string,
    input: CreateEnvironmentInput,
  ): Promise<EnvironmentEntity> {
    return this.environments.manager.transaction(async (manager) => {
      const scoped = await manager
        .createQueryBuilder()
        .from(WorkspaceEntity, 'w')
        .where(
          `w."id" = :workspaceId AND w."id" IN (${SCOPED_WORKSPACE_IDS})`,
          {
            workspaceId: input.workspaceId,
            ...scopeParams(userId, WRITE_ROLES),
          },
        )
        .getExists();

      if (!scoped) {
        await explainParentDenial(
          manager,
          WorkspaceEntity,
          WORKSPACE_SCOPE,
          userId,
          input.workspaceId,
        );
      }

      const position = await appendPosition(
        manager,
        'environments',
        '"workspaceId" = $1',
        [input.workspaceId],
      );

      return manager.save(
        manager.create(EnvironmentEntity, {
          workspace: { id: input.workspaceId },
          name: input.name,
          variables: input.variables ?? [],
          position,
        }),
      );
    });
  }

  async update(
    userId: string,
    id: string,
    changes: UpdateEnvironmentInput,
  ): Promise<EnvironmentEntity> {
    if (Object.keys(changes).length > 0) {
      const result = await this.environments
        .createQueryBuilder()
        .update(EnvironmentEntity)
        .set(changes)
        .where(`"id" = :id AND ${scopedWhere(ENVIRONMENT_SCOPE)}`, {
          id,
          ...scopeParams(userId, WRITE_ROLES),
        })
        .execute();

      if (!result.affected) await this.denied(userId, id);
    }
    return this.findOneScoped(userId, id);
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.environments
      .createQueryBuilder()
      .delete()
      .from(EnvironmentEntity)
      .where(`"id" = :id AND ${scopedWhere(ENVIRONMENT_SCOPE)}`, {
        id,
        ...scopeParams(userId, WRITE_ROLES),
      })
      .execute();

    if (!result.affected) await this.denied(userId, id);
  }

  private async findOneScoped(
    userId: string,
    id: string,
  ): Promise<EnvironmentEntity> {
    const row = await this.environments
      .createQueryBuilder('e')
      .where(`e."id" = :id AND ${scopedWhere(ENVIRONMENT_SCOPE, 'e')}`, {
        id,
        ...scopeParams(userId, WRITE_ROLES),
      })
      .getOne();

    if (!row) await this.denied(userId, id);
    return row!;
  }

  private async assertWorkspaceVisible(
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    const visible = await this.environments.manager
      .createQueryBuilder()
      .from(WorkspaceEntity, 'w')
      .where(`w."id" = :id AND ${scopedWhere(WORKSPACE_SCOPE, 'w')}`, {
        id: workspaceId,
        ...scopeParams(userId, READ_ROLES),
      })
      .getExists();

    if (!visible) {
      await explainDenial(
        this.environments.manager,
        WorkspaceEntity,
        WORKSPACE_SCOPE,
        userId,
        workspaceId,
      );
    }
  }

  private denied(userId: string, id: string): Promise<never> {
    return explainDenial(
      this.environments.manager,
      EnvironmentEntity,
      ENVIRONMENT_SCOPE,
      userId,
      id,
    );
  }
}
