import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  CreateApiRequestInput,
  MoveApiRequestInput,
  UpdateApiRequestInput,
} from '@postman-clone/contracts';
import { EntityManager, Repository } from 'typeorm';
import { appendPosition, positionForMove } from '../common/sibling-positions';
import { CollectionEntity } from '../collections/entities/collection.entity';
import { explainDenial, explainParentDenial } from '../workspaces/scope-denial';
import {
  COLLECTION_SCOPE,
  REQUEST_SCOPE,
  SCOPED_COLLECTION_IDS,
  WRITE_ROLES,
  scopeParams,
  scopedWhere,
} from '../workspaces/workspace-scope';
import { RequestEntity } from './entities/request.entity';

/** ⚠️ `IS NOT DISTINCT FROM` — see the note on `FoldersService`. */
const REQUEST_SIBLINGS =
  '"collectionId" = $1 AND "folderId" IS NOT DISTINCT FROM $2';

@Injectable()
export class RequestsService {
  constructor(
    @InjectRepository(RequestEntity)
    private readonly requests: Repository<RequestEntity>,
  ) {}

  async findOne(userId: string, id: string): Promise<RequestEntity> {
    const row = await this.requests
      .createQueryBuilder('r')
      .where(`r."id" = :id AND ${scopedWhere(REQUEST_SCOPE, 'r')}`, {
        id,
        ...scopeParams(userId, WRITE_ROLES),
      })
      .getOne();

    if (!row) await this.denied(userId, id);
    return row!;
  }

  /**
   * ⚠️ The one create in this feature most likely to be got wrong, so to be
   * explicit: `collectionId` arrives in the **body**. A guard keyed on route
   * params sees no id at all here and would wave through a request created
   * inside a stranger's collection. The parent is resolved through the scoped
   * query below, inside the transaction, with the FK as the race backstop.
   */
  async create(
    userId: string,
    input: CreateApiRequestInput,
  ): Promise<RequestEntity> {
    return this.requests.manager.transaction(async (manager) => {
      await this.assertCollectionWritable(manager, userId, input.collectionId);

      const folderId = input.folderId ?? null;
      if (folderId) {
        await this.assertFolderInCollection(
          manager,
          folderId,
          input.collectionId,
        );
      }

      const position = await appendPosition(
        manager,
        'requests',
        REQUEST_SIBLINGS,
        [input.collectionId, folderId],
      );

      return manager.save(
        manager.create(RequestEntity, {
          collection: { id: input.collectionId },
          folder: folderId ? { id: folderId } : null,
          name: input.name,
          method: input.method ?? 'GET',
          url: input.url ?? '',
          description: input.description ?? null,
          headers: input.headers ?? [],
          queryParams: input.queryParams ?? [],
          body: input.body ?? { mode: 'none' },
          auth: input.auth ?? { type: 'inherit' },
          position,
        }),
      );
    });
  }

  async update(
    userId: string,
    id: string,
    changes: UpdateApiRequestInput,
  ): Promise<RequestEntity> {
    if (Object.keys(changes).length > 0) {
      // The whole authorization test travels inside this one statement: the
      // row is never loaded, so there is no interval in which membership could
      // change between reading it and writing it.
      const result = await this.requests
        .createQueryBuilder()
        .update(RequestEntity)
        .set(changes)
        .where(`"id" = :id AND ${scopedWhere(REQUEST_SCOPE)}`, {
          id,
          ...scopeParams(userId, WRITE_ROLES),
        })
        .execute();

      if (!result.affected) await this.denied(userId, id);
    }
    return this.findOne(userId, id);
  }

  /** Reparent between folders, or to the collection root with `folderId: null`. */
  async move(
    userId: string,
    id: string,
    input: MoveApiRequestInput,
  ): Promise<RequestEntity> {
    await this.requests.manager.transaction(async (manager) => {
      const row = await manager
        .createQueryBuilder()
        .select('r."collectionId"', 'collectionId')
        .from(RequestEntity, 'r')
        .where(`r."id" = :id AND ${scopedWhere(REQUEST_SCOPE, 'r')}`, {
          id,
          ...scopeParams(userId, WRITE_ROLES),
        })
        .getRawOne<{ collectionId: string }>();

      if (!row) await this.denied(userId, id);
      const collectionId = row!.collectionId;

      const folderId = input.folderId ?? null;
      if (folderId) {
        await this.assertFolderInCollection(manager, folderId, collectionId);
      }

      const position = await positionForMove(
        manager,
        'requests',
        REQUEST_SIBLINGS,
        [collectionId, folderId],
        id,
        input.index,
      );

      await manager.query(
        `UPDATE "requests" SET "folderId" = $1, "position" = $2 WHERE "id" = $3`,
        [folderId, position, id],
      );
    });

    return this.findOne(userId, id);
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.requests
      .createQueryBuilder()
      .delete()
      .from(RequestEntity)
      .where(`"id" = :id AND ${scopedWhere(REQUEST_SCOPE)}`, {
        id,
        ...scopeParams(userId, WRITE_ROLES),
      })
      .execute();

    if (!result.affected) await this.denied(userId, id);
  }

  /**
   * The target folder is resolved through the **scoped** collection first, so a
   * folder in someone else's collection answers 404 for the right reason. An
   * unscoped resolve would hit this same-collection check first and produce the
   * same status by accident — passing the test while leaving the hole open.
   */
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
      // Keyed on the collection — the parent the caller named — because no
      // request id exists yet for `explainDenial` to key on.
      await explainParentDenial(
        manager,
        CollectionEntity,
        COLLECTION_SCOPE,
        userId,
        collectionId,
      );
    }
  }

  private denied(userId: string, id: string): Promise<never> {
    return explainDenial(
      this.requests.manager,
      RequestEntity,
      REQUEST_SCOPE,
      userId,
      id,
    );
  }
}
