import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  ImportCollectionInput,
  ImportEnvironmentInput,
  ImportWarning,
} from '@raven/contracts';
import { Repository, type EntityManager } from 'typeorm';
import { CollectionEntity } from '../collections/entities/collection.entity';
import { FolderEntity } from '../collections/entities/folder.entity';
import { appendPosition } from '../common/sibling-positions';
import { EnvironmentEntity } from '../environments/entities/environment.entity';
import { RequestEntity } from '../requests/entities/request.entity';
import { WorkspaceEntity } from '../workspaces/entities/workspace.entity';
import { explainParentDenial } from '../workspaces/scope-denial';
import {
  SCOPED_WORKSPACE_IDS,
  WORKSPACE_SCOPE,
  WRITE_ROLES,
  scopeParams,
} from '../workspaces/workspace-scope';
import {
  mapPostmanCollection,
  type MappedFolder,
  type MappedRequest,
} from './postman-collection.mapper';
import { mapPostmanEnvironment } from './postman-environment.mapper';

/**
 * ⚠️ Rows per `INSERT`. Not a correctness bound — Postgres would take all 5000
 * — but a parameter-count one: every request carries ~14 columns, so an
 * unchunked import of a large collection approaches the 65535 bind-parameter
 * ceiling and fails at the driver with an error that says nothing about
 * importing.
 */
const INSERT_CHUNK = 500;

export interface ImportedCollection {
  collection: CollectionEntity;
  folderCount: number;
  requestCount: number;
  warnings: ImportWarning[];
}

export interface ImportedEnvironment {
  environment: EnvironmentEntity;
  warnings: ImportWarning[];
}

/**
 * Turns a Postman export into rows, in **one transaction**.
 *
 * ⚠️ **All of it or none of it.** A half-imported collection is worse than a
 * failed import: the tree shows something plausible, the user cannot tell which
 * requests are missing, and re-importing gives them a duplicate rather than a
 * repair. This is the opposite call from the *warnings* policy above it — a
 * body mode we cannot send is data, but a failed insert is a failure.
 *
 * ⚠️ **Imports nothing from `WorkspacesModule`**, per the standing rule: the
 * scope fragments are plain constants and `explainParentDenial` is a plain
 * function taking the caller's `EntityManager`, precisely so a module edge is
 * never needed and so the check can enlist in this transaction.
 */
@Injectable()
export class ImportService {
  constructor(
    @InjectRepository(CollectionEntity)
    private readonly collections: Repository<CollectionEntity>,
  ) {}

  async importCollection(
    userId: string,
    input: ImportCollectionInput,
  ): Promise<ImportedCollection> {
    return this.collections.manager.transaction(async (manager) => {
      await this.assertCanWrite(manager, userId, input.workspaceId);

      // Structurally validated by the DTO; total and defensive regardless.
      const mapped = mapPostmanCollection(input.data);

      // ⚠️ **Once, and only for the collection.** It is the only node here with
      // pre-existing siblings; every folder and request belongs to a sibling
      // set this import is creating, and the mapper has already numbered those
      // exactly as `appendPosition` would have.
      const position = await appendPosition(
        manager,
        'collections',
        '"workspaceId" = $1',
        [input.workspaceId],
      );

      const collection = await manager.save(
        manager.create(CollectionEntity, {
          id: mapped.collection.id,
          workspace: { id: input.workspaceId },
          name: mapped.collection.name,
          description: mapped.collection.description,
          auth: mapped.collection.auth,
          variables: mapped.collection.variables,
          position,
        }),
      );

      await this.insertFolders(manager, mapped.folders);
      await this.insertRequests(manager, mapped.requests);

      return {
        collection,
        folderCount: mapped.folders.length,
        requestCount: mapped.requests.length,
        warnings: mapped.warnings,
      };
    });
  }

  async importEnvironment(
    userId: string,
    input: ImportEnvironmentInput,
  ): Promise<ImportedEnvironment> {
    return this.collections.manager.transaction(async (manager) => {
      await this.assertCanWrite(manager, userId, input.workspaceId);

      const mapped = mapPostmanEnvironment(input.data);

      const position = await appendPosition(
        manager,
        'environments',
        '"workspaceId" = $1',
        [input.workspaceId],
      );

      const environment = await manager.save(
        manager.create(EnvironmentEntity, {
          workspace: { id: input.workspaceId },
          name: mapped.environment.name,
          variables: mapped.environment.variables,
          position,
        }),
      );

      return { environment, warnings: mapped.warnings };
    });
  }

  /**
   * The create-path check, identical in shape to `CollectionsService.create`'s
   * — see the long note there. The parent is the workspace, it arrives in the
   * **body**, and the check runs inside the transaction with the foreign key as
   * the race backstop.
   */
  private async assertCanWrite(
    manager: EntityManager,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    const scoped = await manager
      .createQueryBuilder()
      .from(WorkspaceEntity, 'w')
      .where(`w."id" = :workspaceId AND w."id" IN (${SCOPED_WORKSPACE_IDS})`, {
        workspaceId,
        ...scopeParams(userId, WRITE_ROLES),
      })
      .getExists();

    if (!scoped) {
      // Invisible → 404; readable but not writable → 403.
      await explainParentDenial(
        manager,
        WorkspaceEntity,
        WORKSPACE_SCOPE,
        userId,
        workspaceId,
      );
    }
  }

  /**
   * ⚠️ **Grouped by depth, ascending, one multi-row INSERT per level.**
   *
   * `FK_folders_parent` is the composite `("parentFolderId","collectionId") →
   * folders("id","collectionId")` key the migration owns, and it is checked
   * per row at insert time — so a child inserted before its parent fails
   * outright. Sorting the flat list by depth is what makes "parents first"
   * true by construction rather than by luck of the walk order (which is
   * depth-first, and therefore wrong here).
   *
   * The alternative — one `save()` per folder, letting TypeORM order them — is
   * a round trip per node, which for a real export is thousands.
   */
  private async insertFolders(
    manager: EntityManager,
    folders: MappedFolder[],
  ): Promise<void> {
    if (folders.length === 0) return;

    const byDepth = new Map<number, MappedFolder[]>();
    for (const folder of folders) {
      const level = byDepth.get(folder.depth);
      if (level) level.push(folder);
      else byDepth.set(folder.depth, [folder]);
    }

    for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
      const level = byDepth.get(depth)!;
      for (let i = 0; i < level.length; i += INSERT_CHUNK) {
        await manager
          .createQueryBuilder()
          .insert()
          .into(FolderEntity)
          .values(
            level.slice(i, i + INSERT_CHUNK).map((folder) => ({
              id: folder.id,
              // ⚠️ Both halves of each composite key are populated explicitly.
              // `collectionId` is denormalized onto every folder precisely so
              // the FK can be composite; omitting it here fails the constraint.
              collection: { id: folder.collectionId },
              parentFolder: folder.parentFolderId
                ? { id: folder.parentFolderId }
                : null,
              name: folder.name,
              position: folder.position,
            })),
          )
          .execute();
      }
    }
  }

  /**
   * Requests have no ordering constraint among themselves — every parent
   * (collection or folder) already exists by the time this runs — so they go in
   * as one flat chunked bulk insert.
   */
  private async insertRequests(
    manager: EntityManager,
    requests: MappedRequest[],
  ): Promise<void> {
    for (let i = 0; i < requests.length; i += INSERT_CHUNK) {
      await manager
        .createQueryBuilder()
        .insert()
        .into(RequestEntity)
        .values(
          requests.slice(i, i + INSERT_CHUNK).map((request) => ({
            id: request.id,
            collection: { id: request.collectionId },
            folder: request.folderId ? { id: request.folderId } : null,
            name: request.name,
            method: request.method,
            url: request.url,
            description: request.description,
            headers: request.headers,
            queryParams: request.queryParams,
            body: request.body,
            auth: request.auth,
            scripts: request.scripts,
            position: request.position,
          })),
        )
        .execute();
    }
  }
}
