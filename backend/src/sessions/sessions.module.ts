import { Module } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { SessionEntity } from './entities/session.entity';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionsController } from './sessions.controller';

/**
 * Deliberately imports nothing from AuthModule. AuthModule already imports
 * this one, so an import back would be a cycle — and it is unnecessary: the
 * guard is registered globally as an APP_GUARD, and the refresh-cookie helpers
 * are plain functions rather than providers precisely so this edge never has to
 * exist.
 */
@Module({
  imports: [TypeOrmModule.forFeature([SessionEntity, RefreshTokenEntity])],
  providers: [SessionsService],
  controllers: [SessionsController],
  exports: [SessionsService],
})
export class SessionsModule {}
