import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RequestEntity } from '../requests/entities/request.entity';
import { WorkspaceEntity } from '../workspaces/entities/workspace.entity';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';
import { CollectionEntity } from './entities/collection.entity';
import { FolderEntity } from './entities/folder.entity';
import { FoldersController } from './folders.controller';
import { FoldersService } from './folders.service';
import { TreeController } from './tree.controller';
import { TreeService } from './tree.service';

/**
 * `TreeController` lives here despite serving `/workspaces/:id/tree`: Nest does
 * not care which module declares a path, and this is what keeps
 * `WorkspacesModule` free of a `CollectionsModule` edge.
 *
 * The extra entities are registered for their repositories' *managers*, which
 * the scoped queries and the tree's three flat reads use — not because this
 * module owns them.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      CollectionEntity,
      FolderEntity,
      RequestEntity,
      WorkspaceEntity,
    ]),
  ],
  controllers: [CollectionsController, FoldersController, TreeController],
  providers: [CollectionsService, FoldersService, TreeService],
})
export class CollectionsModule {}
