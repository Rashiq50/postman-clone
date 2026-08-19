import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkspaceEntity } from '../workspaces/entities/workspace.entity';
import { EnvironmentEntity } from './entities/environment.entity';
import {
  EnvironmentsController,
  WorkspaceEnvironmentsController,
} from './environments.controller';
import { EnvironmentsService } from './environments.service';

@Module({
  imports: [TypeOrmModule.forFeature([EnvironmentEntity, WorkspaceEntity])],
  controllers: [EnvironmentsController, WorkspaceEnvironmentsController],
  providers: [EnvironmentsService],
})
export class EnvironmentsModule {}
