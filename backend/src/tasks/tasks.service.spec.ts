import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Task } from './entities/task.entity';
import { TasksService } from './tasks.service';

const OWNER = 'owner-1';

describe('TasksService', () => {
  let service: TasksService;
  let repository: {
    create: jest.Mock;
    save: jest.Mock;
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let deleteBuilder: {
    delete: jest.Mock;
    from: jest.Mock;
    where: jest.Mock;
    execute: jest.Mock;
  };

  beforeEach(async () => {
    deleteBuilder = {
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    repository = {
      create: jest.fn((entity: Partial<Task>) => entity),
      save: jest.fn((entity: Partial<Task>) =>
        Promise.resolve({ id: 'task-1', ...entity }),
      ),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      findOne: jest.fn().mockResolvedValue({ id: 'task-1', title: 'Existing' }),
      createQueryBuilder: jest.fn().mockReturnValue(deleteBuilder),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: getRepositoryToken(Task), useValue: repository },
      ],
    }).compile();

    service = module.get(TasksService);
  });

  it('stamps the owner from the caller, not the payload', async () => {
    await service.create(OWNER, {
      title: 'Mine',
      // A client trying to plant a task on another account.
      owner: { id: 'someone-else' },
    } as never);

    const created = repository.create.mock.calls[0][0] as Task;
    expect(created.owner).toEqual({ id: OWNER });
  });

  it('scopes the list to the owner', async () => {
    await service.findAll(OWNER, { page: 1, limit: 10 } as PaginationQueryDto);

    expect(repository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: { owner: { id: OWNER } } }),
    );
  });

  it('scopes a single read to the owner', async () => {
    await service.findOne(OWNER, 'task-1');

    expect(repository.findOne).toHaveBeenCalledWith({
      where: { id: 'task-1', owner: { id: OWNER } },
    });
  });

  it("reports another owner's task as missing rather than forbidden", async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(service.findOne(OWNER, 'task-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('will not update a task the caller does not own', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(
      service.update(OWNER, 'task-1', { title: 'Hijacked' }),
    ).rejects.toThrow(NotFoundException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('constrains the delete by owner in the statement itself', async () => {
    await service.remove(OWNER, 'task-1');

    expect(deleteBuilder.where).toHaveBeenCalledWith(
      expect.stringContaining('ownerId'),
      { id: 'task-1', ownerId: OWNER },
    );
  });

  it('reports a delete that matched nothing as missing', async () => {
    deleteBuilder.execute.mockResolvedValue({ affected: 0 });

    await expect(service.remove(OWNER, 'task-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
