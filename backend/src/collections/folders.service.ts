import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  CreateFolderInput,
  MoveFolderInput,
  UpdateFolderInput,
} from '@postman-clone/contracts';
import { EntityManager, Repository } from 'typeorm';
import { ApiException } from '../common/errors/api.exception';
import { appendPosition, positionForMove } from '../common/sibling-positions';
import { explainDenial, explainParentDenial } from '../workspaces/scope-denial';
import {
  COLLECTION_SCOPE,
  FOLDER_SCOPE,
  SCOPED_COLLECTION_IDS,
  WRITE_ROLES,
  scopeParams,
  scopedWhere,
} from '../workspaces/workspace-scope';
import { CollectionEntity } from './entities/collection.entity';
import { FolderEntity } from './entities/folder.entity';

/**
 * Siblings of a folder: same collection, same parent.
 *
 * ⚠️ `IS NOT DISTINCT FROM`, not `=`. With a NULL `parentFolderId` — which is
 * how a folder sits at the collection root — `= $2` is never true, so every
 * root-level folder would see zero siblings and stack at the same position.
 */
const FOLDER_SIBLINGS =
  '"collectionId" = $1 AND "parentFolderId" IS NOT DISTINCT FROM $2';

@Injectable()
export class FoldersService {
  constructor(
    @InjectRepository(FolderEntity)
    private readonly folders: Repository<FolderEntity>,
  ) {}

  /** See the create-path note on `CollectionsService.create` — same shape. */
  async create(
    userId: string,
    input: CreateFolderInput,
  ): Promise<FolderEntity> {
    return this.folders.manager.transaction(async (manager) => {
      await this.assertCollectionWritable(manager, userId, input.collectionId);

      const parentFolderId = input.parentFolderId ?? null;
      if (parentFolderId) {
        // A parent from another collection is a 404, not a 409: the caller has
        // no business knowing it exists. The composite FK would reject the
        // insert anyway, but as a constraint violation rather than an answer.
        await this.assertFolderInCollection(
          manager,
          parentFolderId,
          input.collectionId,
        );
      }

      const position = await appendPosition(
        manager,
        'folders',
        FOLDER_SIBLINGS,
        [input.collectionId, parentFolderId],
      );

      return manager.save(
        manager.create(FolderEntity, {
          collection: { id: input.collectionId },
          parentFolder: parentFolderId ? { id: parentFolderId } : null,
          name: input.name,
          position,
        }),
      );
    });
  }

  async update(
    userId: string,
    id: string,
    changes: UpdateFolderInput,
  ): Promise<FolderEntity> {
    if (Object.keys(changes).length > 0) {
      const result = await this.folders
        .createQueryBuilder()
        .update(FolderEntity)
        .set(changes)
        .where(`"id" = :id AND ${scopedWhere(FOLDER_SCOPE)}`, {
          id,
          ...scopeParams(userId, WRITE_ROLES),
        })
        .execute();

      if (!result.affected) await this.denied(userId, id);
    }
    return this.findOneScoped(userId, id);
  }

  /**
   * Reparent and/or reorder. A folder never changes collection — the composite
   * FK makes that unrepresentable — so `collectionId` is read from the row
   * rather than taken from the caller.
   */
  async move(
    userId: string,
    id: string,
    input: MoveFolderInput,
  ): Promise<FolderEntity> {
    await this.folders.manager.transaction(async (manager) => {
      const row = await manager
        .createQueryBuilder()
        .select('f."collectionId"', 'collectionId')
        .from(FolderEntity, 'f')
        .where(`f."id" = :id AND ${scopedWhere(FOLDER_SCOPE, 'f')}`, {
          id,
          ...scopeParams(userId, WRITE_ROLES),
        })
        .getRawOne<{ collectionId: string }>();

      if (!row) await this.denied(userId, id);
      const collectionId = row!.collectionId;

      const parentFolderId = input.parentFolderId ?? null;
      if (parentFolderId) {
        // Resolved through the *scoped* path first, so a target in someone
        // else's collection is a 404 rather than falling through to the
        // same-collection check and being right for the wrong reason.
        await this.assertFolderInCollection(
          manager,
          parentFolderId,
          collectionId,
        );
        await this.assertNotDescendant(manager, id, parentFolderId);
      }

      const position = await positionForMove(
        manager,
        'folders',
        FOLDER_SIBLINGS,
        [collectionId, parentFolderId],
        id,
        input.index,
      );

      await manager.query(
        `UPDATE "folders" SET "parentFolderId" = $1, "position" = $2 WHERE "id" = $3`,
        [parentFolderId, position, id],
      );
    });

    return this.findOneScoped(userId, id);
  }

  /** The subtree below follows by `ON DELETE CASCADE` on the composite FK. */
  async remove(userId: string, id: string): Promise<void> {
    const result = await this.folders
      .createQueryBuilder()
      .delete()
      .from(FolderEntity)
      .where(`"id" = :id AND ${scopedWhere(FOLDER_SCOPE)}`, {
        id,
        ...scopeParams(userId, WRITE_ROLES),
      })
      .execute();

    if (!result.affected) await this.denied(userId, id);
  }

  /**
   * ⚠️ The cycle check, and it has to be here rather than in the schema.
   *
   * Making a folder its own descendant's child produces a loop that is
   * perfectly self-consistent as far as the foreign key is concerned — every
   * row still points at a real parent in the same collection. What actually
   * happens is that the whole ring detaches from the collection root, so it
   * renders nowhere, and because the UI can no longer reach it, it also cannot
   * be deleted. Invisible *and* undeletable.
   */
  private async assertNotDescendant(
    manager: EntityManager,
    folderId: string,
    proposedParentId: string,
  ): Promise<void> {
    const cycle = await manager.query<{ '?column?': number }[]>(
      `WITH RECURSIVE descendants AS (
         SELECT "id" FROM "folders" WHERE "id" = $1
         UNION ALL
         SELECT f."id" FROM "folders" f JOIN descendants d ON f."parentFolderId" = d."id"
       )
       SELECT 1 FROM descendants WHERE "id" = $2 LIMIT 1`,
      [folderId, proposedParentId],
    );

    if (cycle.length > 0) {
      throw ApiException.conflict('A folder cannot be moved inside itself');
    }
  }

  /** A folder that is not in `collectionId` is reported as simply not there. */
  private async assertFolderInCollection(
    manager: EntityManager,
    folderId: string,
    collectionId: string,
  ): Promise<void> {
    const found = await manager.query<{ '?column?': number }[]>(
      `SELECT 1 FROM "folders" WHERE "id" = $1 AND "collectionId" = $2 LIMIT 1`,
      [folderId, collectionId],
    );
    if (found.length === 0) {
      throw new NotFoundException(`Folder with id "${folderId}" not found`);
    }
  }

  private async assertCollectionWritable(
    manager: EntityManager,
    userId: string,
    collectionId: string,
  ): Promise<void> {
    const scoped = await manager
      .createQueryBuilder()
      .from(CollectionEntity, 'c')
      .where(
        `c."id" = :collectionId AND c."id" IN (${SCOPED_COLLECTION_IDS})`,
        {
          collectionId,
          ...scopeParams(userId, WRITE_ROLES),
        },
      )
      .getExists();

    if (!scoped) {
      await explainParentDenial(
        manager,
        CollectionEntity,
        COLLECTION_SCOPE,
        userId,
        collectionId,
      );
    }
  }

  private async findOneScoped(
    userId: string,
    id: string,
  ): Promise<FolderEntity> {
    const row = await this.folders
      .createQueryBuilder('f')
      .where(`f."id" = :id AND ${scopedWhere(FOLDER_SCOPE, 'f')}`, {
        id,
        ...scopeParams(userId, WRITE_ROLES),
      })
      .getOne();

    if (!row) await this.denied(userId, id);
    return row!;
  }

  private denied(userId: string, id: string): Promise<never> {
    return explainDenial(
      this.folders.manager,
      FolderEntity,
      FOLDER_SCOPE,
      userId,
      id,
    );
  }
}
