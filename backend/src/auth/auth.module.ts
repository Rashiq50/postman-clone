import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../users/entities/user.entity';
import { SessionsService } from '../sessions/sessions.service';
import { SessionEntity } from '../sessions/entities/session.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, SessionEntity])],
  controllers: [AuthController],
  providers: [AuthService, SessionsService]
})
export class AuthModule { }
