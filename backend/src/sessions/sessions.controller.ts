import { Body, Controller, Post } from '@nestjs/common';
import { API_VERSION } from '@postman-clone/contracts';
import { SessionsService } from './sessions.service';
import { SessionEntity } from './entities/session.entity';

@Controller({ path: 'sessions', version: API_VERSION })
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post('create')
  async create(@Body() body: { userId: string }): Promise<{
    session: SessionEntity;
    refreshToken: string;
  }> {
    return await this.sessionsService.create(body.userId);
  }
}
