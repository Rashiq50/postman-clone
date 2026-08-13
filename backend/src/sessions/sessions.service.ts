import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SessionEntity } from './entities/session.entity';

@Injectable()
export class SessionsService {
    constructor(
        @InjectRepository(SessionEntity)
        private readonly sessionsRepository: Repository<SessionEntity>,
    ) { }

    // TODO: Implement the service methods
}
