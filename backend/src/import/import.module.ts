import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CollectionEntity } from '../collections/entities/collection.entity';
import { FolderEntity } from '../collections/entities/folder.entity';
import { EnvironmentEntity } from '../environments/entities/environment.entity';
import { RequestEntity } from '../requests/entities/request.entity';
import { WorkspaceEntity } from '../workspaces/entities/workspace.entity';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';

/**
 * ⚠️ **Imports no other feature module** — not `WorkspacesModule`, not
 * `CollectionsModule`, not `EnvironmentsModule`. Everything it needs from them
 * is either a plain function (`explainParentDenial`, `appendPosition`), a plain
 * constant (the scope fragments) or a response DTO's static `from`. The
 * entities below are registered for the repository *manager* the service runs
 * its one transaction on, exactly as `CollectionsModule` registers the ones it
 * does not own.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      CollectionEntity,
      FolderEntity,
      RequestEntity,
      EnvironmentEntity,
      WorkspaceEntity,
    ]),
  ],
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
