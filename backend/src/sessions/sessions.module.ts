import { Module } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { SessionEntity } from './entities/session.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionsController } from './sessions.controller';
import { UserEntity } from '../users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SessionEntity, UserEntity])],
  providers: [SessionsService],
  controllers: [SessionsController],
})
export class SessionsModule {}
