import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from './entities/user.entity';

/**
 * Read access to users. Both lookups return `null` rather than throwing: "no
 * such user" is an ordinary answer here, and the decision about what it means
 * belongs to the caller. `AuthService` turns it into a flat-timing credential
 * rejection; a handler behind the guard would turn it into a 401.
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
  ) { }

  async create(
    email: string,
    passwordHash: string,
    name: string,
  ) {
    const user = this.usersRepository.manager.transaction(
      async (manager) => {
        const created = manager.create(UserEntity, {
          email,
          passwordHash,
          name,
        });
        await manager.save(created);
        return created;
      },
    )

    return user;

  }

  findById(id: string): Promise<UserEntity | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  findByEmail(email: string): Promise<UserEntity | null> {
    return this.usersRepository.findOne({ where: { email } });
  }
}
