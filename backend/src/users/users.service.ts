import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
   */
  create(
    email: string,
    passwordHash: string,
    name: string,
  ): Promise<UserEntity> {
    return this.usersRepository.save(
      this.usersRepository.create({ email, passwordHash, name }),
    );
  }

  findById(id: string): Promise<UserEntity | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  findByEmail(email: string): Promise<UserEntity | null> {
    return this.usersRepository.findOne({ where: { email } });
  }
}
