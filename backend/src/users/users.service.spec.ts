import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkspaceMemberEntity } from '../workspaces/entities/workspace-member.entity';
import { WorkspaceEntity } from '../workspaces/entities/workspace.entity';
import { UserEntity } from './entities/user.entity';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let manager: {
    create: jest.Mock;
    save: jest.Mock;
    transaction: jest.Mock;
  };
  let usersRepository: { findOne: jest.Mock; manager: typeof manager };

  beforeEach(async () => {
    manager = {
      create: jest.fn(
        (_entity: unknown, payload: Record<string, unknown>) => payload,
      ),
      save: jest.fn((payload: Record<string, unknown>) =>
        Promise.resolve({ id: 'user-1', ...payload }),
      ),
      // Runs the callback with the same manager and — like the real thing —
      // re-throws whatever it raises without wrapping it.
      transaction: jest.fn(
        (run: (m: unknown) => Promise<unknown>): Promise<unknown> =>
          run(manager),
      ),
    };
    usersRepository = { findOne: jest.fn().mockResolvedValue(null), manager };

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

  describe('create', () => {
    it('creates the user and provisions a personal workspace in ONE transaction', async () => {
      // The invariant this whole design turns on. A user row without a
      // workspace is a silently and permanently broken account: registration
      // still returns 201 with a working token, `GET /workspaces` is empty,
      // and no endpoint repairs it. Provisioning outside this transaction is
      // exactly how that ships.
      await service.create('new@example.com', 'hash', 'New User');

      expect(manager.transaction).toHaveBeenCalledTimes(1);

      const entities = manager.create.mock.calls.map(
        ([entity]: [unknown]) => entity,
      );
      expect(entities).toEqual([
        UserEntity,
        WorkspaceEntity,
        WorkspaceMemberEntity,
      ]);
    });

    it('provisions for the id the database assigned, not one invented beforehand', async () => {
      await service.create('new@example.com', 'hash', 'New User');

      const [, workspacePayload] = manager.create.mock.calls[1] as [
        unknown,
        { owner: { id: string } },
      ];
      expect(workspacePayload.owner).toEqual({ id: 'user-1' });
    });

    it('returns the saved user', async () => {
      await expect(
        service.create('new@example.com', 'hash', 'New User'),
      ).resolves.toEqual(
        expect.objectContaining({ id: 'user-1', email: 'new@example.com' }),
      );
    });

    it('lets the driver error through unchanged, so 23505 still reaches AuthService', async () => {
      // `AuthService.register` maps the unique violation on `users.email` to
      // EMAIL_TAKEN. Wrapping or swallowing it here would turn a duplicate
      // signup into a 500.
      const violation = Object.assign(new Error('duplicate key'), {
        driverError: { code: '23505' },
      });
      manager.save.mockRejectedValueOnce(violation);

      await expect(
        service.create('taken@example.com', 'hash', 'Taken'),
      ).rejects.toBe(violation);
    });
  });
});
