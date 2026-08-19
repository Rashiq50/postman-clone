import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserEntity } from './entities/user.entity';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let usersRepository: { findOne: jest.Mock };

  beforeEach(async () => {
    usersRepository = { findOne: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: usersRepository,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('looks a user up by id', async () => {
    const user = { id: 'user-1' } as UserEntity;
    usersRepository.findOne.mockResolvedValue(user);

    await expect(service.findById('user-1')).resolves.toBe(user);
    expect(usersRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'user-1' },
    });
  });

  it('looks a user up by email', async () => {
    const user = { id: 'user-1' } as UserEntity;
    usersRepository.findOne.mockResolvedValue(user);

    await expect(service.findByEmail('seed@example.com')).resolves.toBe(user);
    expect(usersRepository.findOne).toHaveBeenCalledWith({
      where: { email: 'seed@example.com' },
    });
  });

  // "No such user" is an ordinary answer here; what it *means* is the caller's
  // decision. AuthService turns it into a flat-timing credential rejection.
  it('returns null rather than throwing when nobody matches', async () => {
    await expect(service.findById('nope')).resolves.toBeNull();
    await expect(service.findByEmail('nope@example.com')).resolves.toBeNull();
  });
});
