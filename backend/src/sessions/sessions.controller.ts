import { Body, Controller, Post } from '@nestjs/common';
import { API_VERSION } from '@postman-clone/contracts';
import { SessionsService } from './sessions.service';
import { SessionEntity } from './entities/session.entity';
import { LoginDto } from './dto/login-dto';

@Controller({ path: 'sessions', version: API_VERSION })
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) { }

  @Post('login')
  async login(@Body() loginDto: LoginDto): Promise<{
    session: SessionEntity;
    refreshToken: string;
  }> {
    return await this.sessionsService.login(loginDto.email, loginDto.password);
  }
}
