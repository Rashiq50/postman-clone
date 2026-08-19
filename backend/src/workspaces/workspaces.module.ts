import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkspaceMemberEntity } from './entities/workspace-member.entity';
import { WorkspaceEntity } from './entities/workspace.entity';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

/**
 * No `AuthModule` import — the JWT guard is a global `APP_GUARD`. And nothing
 * imports *this* module either: `workspace-scope.ts`, `scope-denial.ts` and
 * `provision-personal-workspace.ts` are plain functions rather than providers,
 * which is what keeps the dependency graph a straight line instead of a web of
 * `→ WorkspacesModule` edges. Same precedent as `refresh-cookie.ts`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([WorkspaceEntity, WorkspaceMemberEntity])],
  controllers: [WorkspacesController],
  providers: [WorkspacesService],
})
export class WorkspacesModule {}
