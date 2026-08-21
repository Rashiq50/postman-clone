import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { WorkspaceTree } from '@raven/contracts';
import { Repository } from 'typeorm';
import { RequestEntity } from '../requests/entities/request.entity';
import { WorkspaceEntity } from '../workspaces/entities/workspace.entity';
import { explainDenial } from '../workspaces/scope-denial';
import {
  READ_ROLES,
  WORKSPACE_SCOPE,
  scopeParams,
  scopedWhere,
} from '../workspaces/workspace-scope';
import {
  buildTree,
  type FlatCollection,
  type FlatFolder,
  type FlatRequest,
} from './build-tree';
import { CollectionEntity } from './entities/collection.entity';
import { FolderEntity } from './entities/folder.entity';

/**
 * The whole sidebar in one response.
 *
 * Three flat `SELECT`s, each hitting its table's `(parent, position)` index,
 * assembled by the pure `buildTree`. Membership is checked once, against the
 * workspace, and the three reads then scope through it — the collections read
 * is itself scoped, and folders and requests are constrained to the collections
 * it returned, so a stranger's row cannot appear even if a collection id were
 * guessed.
 *
 * Request nodes carry only what the sidebar draws — no `url`, `headers`, `body`
 * or `auth`. That is what makes fetching the entire workspace eagerly cheap
 * enough to be the simpler design.
 */
@Injectable()
export class TreeService {
  constructor(
    @InjectRepository(CollectionEntity)
    private readonly collections: Repository<CollectionEntity>,
  ) {}

  async findByWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceTree> {
    const manager = this.collections.manager;

    const visible = await manager
      .createQueryBuilder()
      .from(WorkspaceEntity, 'w')
      .where(`w."id" = :id AND ${scopedWhere(WORKSPACE_SCOPE, 'w')}`, {
        id: workspaceId,
        ...scopeParams(userId, READ_ROLES),
      })
      .getExists();

    if (!visible) {
      await explainDenial(
        manager,
        WorkspaceEntity,
        WORKSPACE_SCOPE,
        userId,
        workspaceId,
      );
    }

    const collections = await manager
      .createQueryBuilder()
      .select([
        'c."id" AS "id"',
        'c."name" AS "name"',
        'c."description" AS "description"',
        'c."position" AS "position"',
        'c."createdAt" AS "createdAt"',
      ])
      .from(CollectionEntity, 'c')
      .where('c."workspaceId" = :workspaceId', { workspaceId })
      .getRawMany<FlatCollection>();

    if (collections.length === 0) {
      // An empty workspace is a tree with no collections, not an error.
      return buildTree(workspaceId, [], [], []);
    }

    const collectionIds = collections.map((collection) => collection.id);

    const [folders, requests] = await Promise.all([
      manager
        .createQueryBuilder()
        .select([
          'f."id" AS "id"',
          'f."collectionId" AS "collectionId"',
          'f."parentFolderId" AS "parentFolderId"',
          'f."name" AS "name"',
          'f."position" AS "position"',
          'f."createdAt" AS "createdAt"',
        ])
        .from(FolderEntity, 'f')
        .where('f."collectionId" IN (:...collectionIds)', { collectionIds })
        .getRawMany<FlatFolder>(),
      manager
        .createQueryBuilder()
        .select([
          'r."id" AS "id"',
          'r."collectionId" AS "collectionId"',
          'r."folderId" AS "folderId"',
          'r."name" AS "name"',
          'r."method" AS "method"',
          'r."position" AS "position"',
          'r."createdAt" AS "createdAt"',
        ])
        .from(RequestEntity, 'r')
        .where('r."collectionId" IN (:...collectionIds)', { collectionIds })
        .getRawMany<FlatRequest>(),
    ]);

    return buildTree(workspaceId, collections, folders, requests);
  }
}
