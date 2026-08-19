import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CollectionEntity } from '../collections/entities/collection.entity';
import { RequestEntity } from './entities/request.entity';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

@Module({
  imports: [TypeOrmModule.forFeature([RequestEntity, CollectionEntity])],
  controllers: [RequestsController],
  providers: [RequestsService],
})
export class RequestsModule {}
