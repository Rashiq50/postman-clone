import { Controller } from '@nestjs/common';
import { API_VERSION } from '@postman-clone/contracts';
import { SessionsService } from './sessions.service';

@Controller({ path: 'sessions', version: API_VERSION })
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

}
