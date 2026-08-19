import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { provisionPersonalWorkspace } from '../workspaces/provision-personal-workspace';
import { UserEntity } from './entities/user.entity';

/**
 * User lookups and creation. Both lookups return `null` rather than throwing:
 * "no such user" is an ordinary answer here, and the decision about what it
 * means belongs to the caller. `AuthService` turns it into a flat-timing
 * credential rejection; a handler behind the guard would turn it into a 401.
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
  ) {}

  /**
   * The unique index on `email` is the duplicate check — callers catch the
   * violation rather than pre-checking, so concurrent submits cannot race
   * past a `findByEmail`.
   *
   * The personal workspace is provisioned **in the same transaction**, not
   * afterwards by the caller. A user row with no workspace is a silently and
   * permanently broken account — registration still returns 201 with a working
   * token, `GET /workspaces` is empty, and nothing repairs it — so the two
   * writes must succeed or fail together.
   *
   * Putting it here rather than in `AuthService.register` is what leaves that
   * method unchanged. `manager.transaction` re-throws the driver error
   * untouched, so its `23505 → EMAIL_TAKEN` catch still fires and the
   * workspace rolls back with the user. `auth.service.spec.ts` pins that.
   */
  create(
    email: string,
    passwordHash: string,
    name: string,
  ): Promise<UserEntity> {
    return this.usersRepository.manager.transaction(async (manager) => {
      const user = await manager.save(
        manager.create(UserEntity, { email, passwordHash, name }),
      );
      await provisionPersonalWorkspace(manager, user.id);
      return user;
    });
  }

  findById(id: string): Promise<UserEntity | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  findByEmail(email: string): Promise<UserEntity | null> {
    return this.usersRepository.findOne({ where: { email } });
  }
}
