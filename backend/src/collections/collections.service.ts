import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  CreateCollectionInput,
  UpdateCollectionInput,
} from '@postman-clone/contracts';
import { Repository } from 'typeorm';
import { appendPosition, positionForMove } from '../common/sibling-positions';
import { explainDenial, explainParentDenial } from '../workspaces/scope-denial';
import { WorkspaceEntity } from '../workspaces/entities/workspace.entity';
import {
  COLLECTION_SCOPE,
  SCOPED_WORKSPACE_IDS,
  WORKSPACE_SCOPE,
  WRITE_ROLES,
  scopeParams,
  scopedWhere,
} from '../workspaces/workspace-scope';
import { CollectionEntity } from './entities/collection.entity';

@Injectable()
export class CollectionsService {
  constructor(
    @InjectRepository(CollectionEntity)
    private readonly collections: Repository<CollectionEntity>,
  ) {}

  /**
   * The create path. The scoped-`UPDATE` pattern used by update/move/delete
   * does **not** transfer here — there is no row to scope, so `affected === 0`
   * never arises — and the parent id arrives in the **body**, which is exactly
   * where a route-param guard cannot see it. So:
   *
   * 1. resolve the parent through the scoped query, inside the transaction;
   * 2. read the sibling `MAX("position")`;
   * 3. insert.
   *
   * The check-then-insert gap between 1 and 3 is closed by the foreign key,
   * not by hoping: if the workspace is deleted in between, the insert fails on
   * `FK_collections_workspaceId`. The race degrades to an error, never to a
   * cross-tenant write — which is what makes a scoped `SELECT` inside the
   * transaction acceptable here where a guard outside it would not be.
   */
  async create(
    userId: string,
    input: CreateCollectionInput,
  ): Promise<CollectionEntity> {
    return this.collections.manager.transaction(async (manager) => {
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
        // Keyed on the workspace, because the workspace is what the caller
        // named. Readable but not writable → 403; invisible → 404.
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
        'collections',
        '"workspaceId" = $1',
        [input.workspaceId],
      );

      return manager.save(
        manager.create(CollectionEntity, {
          workspace: { id: input.workspaceId },
          name: input.name,
          description: input.description ?? null,
          position,
        }),
      );
    });
  }

  async update(
    userId: string,
    id: string,
    changes: UpdateCollectionInput,
  ): Promise<CollectionEntity> {
    if (Object.keys(changes).length > 0) {
      const result = await this.collections
        .createQueryBuilder()
        .update(CollectionEntity)
        .set(changes)
        .where(`"id" = :id AND ${scopedWhere(COLLECTION_SCOPE)}`, {
          id,
          ...scopeParams(userId, WRITE_ROLES),
        })
        .execute();

      if (!result.affected) await this.denied(userId, id);
    }
    return this.findOneScoped(userId, id);
  }

  /**
   * Collections have no parent to change, so a move is only a reorder among the
   * workspace's other collections.
   */
  async move(
    userId: string,
    id: string,
    index: number,
  ): Promise<CollectionEntity> {
    await this.collections.manager.transaction(async (manager) => {
      const row = await manager
        .createQueryBuilder()
        .select('c."workspaceId"', 'workspaceId')
        .from(CollectionEntity, 'c')
        .where(`c."id" = :id AND ${scopedWhere(COLLECTION_SCOPE, 'c')}`, {
          id,
          ...scopeParams(userId, WRITE_ROLES),
        })
        .getRawOne<{ workspaceId: string }>();

      if (!row) await this.denied(userId, id);

      const position = await positionForMove(
        manager,
        'collections',
        '"workspaceId" = $1',
        [row!.workspaceId],
        id,
        index,
      );

      await manager.query(
        `UPDATE "collections" SET "position" = $1 WHERE "id" = $2`,
        [position, id],
      );
    });

    return this.findOneScoped(userId, id);
  }

  /** Folders and requests below follow by `ON DELETE CASCADE`, not by code. */
  async remove(userId: string, id: string): Promise<void> {
    const result = await this.collections
      .createQueryBuilder()
      .delete()
      .from(CollectionEntity)
      .where(`"id" = :id AND ${scopedWhere(COLLECTION_SCOPE)}`, {
        id,
        ...scopeParams(userId, WRITE_ROLES),
      })
      .execute();

    if (!result.affected) await this.denied(userId, id);
  }

  private async findOneScoped(
    userId: string,
    id: string,
  ): Promise<CollectionEntity> {
    const row = await this.collections
      .createQueryBuilder('c')
      .where(`c."id" = :id AND ${scopedWhere(COLLECTION_SCOPE, 'c')}`, {
        id,
        ...scopeParams(userId, WRITE_ROLES),
      })
      .getOne();

    if (!row) await this.denied(userId, id);
    return row!;
  }

  private denied(userId: string, id: string): Promise<never> {
    return explainDenial(
      this.collections.manager,
      CollectionEntity,
      COLLECTION_SCOPE,
      userId,
      id,
    );
  }
}
