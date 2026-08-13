import { Module } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { SessionEntity } from './entities/session.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionsController } from './sessions.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SessionEntity])],
  providers: [SessionsService],
  controllers: [SessionsController],
  exports: [SessionsService]
})
export class SessionsModule { }
