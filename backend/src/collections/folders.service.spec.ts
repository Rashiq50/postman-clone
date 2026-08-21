import { HttpStatus, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ApiErrorCode } from '@raven/contracts';
import { FolderEntity } from './entities/folder.entity';
import { FoldersService } from './folders.service';

const USER = 'user-1';
const FOLDER_ID = '11111111-1111-4111-8111-111111111111';
const PARENT_ID = '22222222-2222-4222-8222-222222222222';
const COLLECTION_ID = '33333333-3333-4333-8333-333333333333';

function builder() {
  const calls: { sql: string; params: Record<string, unknown> }[] = [];
  const self: Record<string, jest.Mock> = {};
  for (const method of ['select', 'from', 'update', 'delete', 'set']) {
    self[method] = jest.fn(() => self);
  }
  self.where = jest.fn((sql: string, params: Record<string, unknown>) => {
    calls.push({ sql, params });
    return self;
  });
  self.execute = jest.fn().mockResolvedValue({ affected: 1 });
  self.getOne = jest.fn().mockResolvedValue({ id: FOLDER_ID });
  self.getExists = jest.fn().mockResolvedValue(true);
  self.getRawOne = jest.fn().mockResolvedValue({ collectionId: COLLECTION_ID });
  return { self, calls };
}

/**
 * Routes a raw SQL string to a canned result. The cycle check, the
 * same-collection check and the sibling lock are all `manager.query`, so the
 * tests have to distinguish them by their SQL.
 */
function queryRouter(overrides: {
  cycle?: unknown[];
  folderInCollection?: unknown[];
  siblings?: unknown[];
}) {
  return jest.fn((sql: string) => {
    if (sql.includes('WITH RECURSIVE')) {
      return Promise.resolve(overrides.cycle ?? []);
    }
    if (sql.includes('SELECT 1 FROM "folders"')) {
      return Promise.resolve(
        overrides.folderInCollection ?? [{ '?column?': 1 }],
      );
    }
    if (sql.includes('FOR UPDATE')) {
      return Promise.resolve(overrides.siblings ?? []);
    }
    if (sql.includes('MAX(')) return Promise.resolve([{ max: null }]);
    return Promise.resolve([]);
  });
}

describe('FoldersService', () => {
  let service: FoldersService;
  let managerBuilder: ReturnType<typeof builder>;
  let manager: {
    createQueryBuilder: jest.Mock;
    transaction: jest.Mock;
    query: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  function build(queries = queryRouter({})) {
    managerBuilder = builder();
    manager = {
      createQueryBuilder: jest.fn(() => managerBuilder.self),
      transaction: jest.fn((run: (m: unknown) => Promise<unknown>) =>
        run(manager),
      ),
      query: queries,
      create: jest.fn((_entity: unknown, payload: unknown) => payload),
      save: jest.fn((payload: Record<string, unknown>) =>
        Promise.resolve({ id: FOLDER_ID, ...payload }),
      ),
    };
    return {
      manager,
      createQueryBuilder: jest.fn(() => builder().self),
    };
  }

  async function makeService(queries?: jest.Mock) {
    const repository = build(queries);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FoldersService,
        { provide: getRepositoryToken(FolderEntity), useValue: repository },
      ],
    }).compile();
    service = module.get(FoldersService);
  }

  beforeEach(() => makeService());

  describe('move', () => {
    it("rejects a move into the folder's own descendant with 409", async () => {
      // ⚠️ The foreign key does NOT catch this. A cycle is entirely
      // self-consistent — every row still points at a real parent in the same
      // collection — but the whole ring detaches from the collection root, so
      // it renders nowhere and, being unreachable from the UI, cannot be
      // deleted either. Invisible *and* undeletable.
      await makeService(queryRouter({ cycle: [{ '?column?': 1 }] }));

      await expect(
        service.move(USER, FOLDER_ID, { parentFolderId: PARENT_ID }),
      ).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
        response: { code: ApiErrorCode.CONFLICT },
      });
    });

    it('names the folder being moved when it walks the descendant chain', async () => {
      const queries = queryRouter({ cycle: [{ '?column?': 1 }] });
      await makeService(queries);

      await expect(
        service.move(USER, FOLDER_ID, { parentFolderId: PARENT_ID }),
      ).rejects.toBeDefined();

      const recursive = queries.mock.calls.find(([sql]: [string]) =>
        sql.includes('WITH RECURSIVE'),
      ) as [string, unknown[]];
      expect(recursive[1]).toEqual([FOLDER_ID, PARENT_ID]);
    });

    it('allows a legal move and writes the new parent and position', async () => {
      const queries = queryRouter({ cycle: [], siblings: [] });
      await makeService(queries);

      await service.move(USER, FOLDER_ID, { parentFolderId: PARENT_ID });

      const update = queries.mock.calls.find(([sql]: [string]) =>
        sql.startsWith('UPDATE "folders" SET "parentFolderId"'),
      ) as [string, unknown[]];
      expect(update[1]).toEqual([PARENT_ID, 1024, FOLDER_ID]);
    });

    it('runs the cycle check BEFORE taking the sibling lock', async () => {
      // Holding a lock while doing work that is about to be thrown away is
      // pointless contention, and the cycle answer never depends on it.
      const order: string[] = [];
      const queries = jest.fn((sql: string) => {
        if (sql.includes('WITH RECURSIVE')) {
          order.push('cycle');
          return Promise.resolve([]);
        }
        if (sql.includes('FOR UPDATE')) {
          order.push('lock');
          return Promise.resolve([]);
        }
        if (sql.includes('SELECT 1 FROM "folders"')) {
          order.push('same-collection');
          return Promise.resolve([{ '?column?': 1 }]);
        }
        return Promise.resolve([]);
      });
      await makeService(queries);

      await service.move(USER, FOLDER_ID, { parentFolderId: PARENT_ID });

      expect(order).toEqual(['same-collection', 'cycle', 'lock']);
    });

    it('skips the cycle check when moving to the collection root', async () => {
      // There is no parent to be a descendant of.
      const queries = queryRouter({});
      await makeService(queries);

      await service.move(USER, FOLDER_ID, { parentFolderId: null });

      expect(
        queries.mock.calls.some(([sql]: [string]) =>
          sql.includes('WITH RECURSIVE'),
        ),
      ).toBe(false);
    });

    it('rejects a target folder from another collection as not found', async () => {
      await makeService(queryRouter({ folderInCollection: [] }));

      await expect(
        service.move(USER, FOLDER_ID, { parentFolderId: PARENT_ID }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('locks siblings with IS NOT DISTINCT FROM so root-level moves see each other', async () => {
      const queries = queryRouter({});
      await makeService(queries);

      await service.move(USER, FOLDER_ID, { parentFolderId: null });

      const lock = queries.mock.calls.find(([sql]: [string]) =>
        sql.includes('FOR UPDATE'),
      ) as [string, unknown[]];
      expect(lock[0]).toContain('IS NOT DISTINCT FROM');
      // The moving folder is excluded, or it would be its own neighbour.
      expect(lock[1]).toEqual([COLLECTION_ID, null, FOLDER_ID]);
    });
  });

  describe('create', () => {
    it('resolves the parent collection through the scoped query first', async () => {
      await service.create(USER, { collectionId: COLLECTION_ID, name: 'v1' });

      const scoped = managerBuilder.calls[0];
      expect(scoped.sql).toContain('"workspace_members"');
      expect(scoped.params).toMatchObject({
        collectionId: COLLECTION_ID,
        userId: USER,
        roles: ['OWNER', 'ADMIN', 'EDITOR'],
      });
    });

    it('never inserts when the parent collection is not writable', async () => {
      managerBuilder.self.getExists.mockResolvedValue(false);

      await expect(
        service.create(USER, { collectionId: COLLECTION_ID, name: 'v1' }),
      ).rejects.toBeDefined();
      expect(manager.save).not.toHaveBeenCalled();
    });
  });
});
