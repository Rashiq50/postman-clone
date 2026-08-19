import { HttpStatus, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ApiErrorCode } from '@postman-clone/contracts';
import { RequestEntity } from './entities/request.entity';
import { RequestsService } from './requests.service';

const USER = 'user-1';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const COLLECTION_ID = '22222222-2222-4222-8222-222222222222';

/**
 * A chainable query-builder double. Every builder method returns `this`, so a
 * test only has to say what the *terminal* call resolves to — and the `where`
 * calls are recorded, which is what lets these tests assert on the SQL that
 * carries the authorization.
 */
function builder() {
  const calls: { sql: string; params: Record<string, unknown> }[] = [];
  const self: Record<string, jest.Mock> = {};
  for (const method of [
    'select',
    'from',
    'update',
    'delete',
    'set',
    'orderBy',
    'addOrderBy',
  ]) {
    self[method] = jest.fn(() => self);
  }
  self.where = jest.fn((sql: string, params: Record<string, unknown>) => {
    calls.push({ sql, params });
    return self;
  });
  self.execute = jest.fn().mockResolvedValue({ affected: 1 });
  self.getOne = jest.fn().mockResolvedValue({ id: REQUEST_ID });
  // Existence probes go through `getExists()`; the raw variants remain for the
  // reads that actually select columns.
  self.getExists = jest.fn().mockResolvedValue(true);
  self.getRawOne = jest.fn().mockResolvedValue({ '1': 1 });
  return { self, calls };
}

describe('RequestsService', () => {
  let service: RequestsService;
  let repoBuilder: ReturnType<typeof builder>;
  let managerBuilder: ReturnType<typeof builder>;
  let manager: {
    createQueryBuilder: jest.Mock;
    transaction: jest.Mock;
    query: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(async () => {
    repoBuilder = builder();
    managerBuilder = builder();

    manager = {
      createQueryBuilder: jest.fn(() => managerBuilder.self),
      transaction: jest.fn((run: (m: unknown) => Promise<unknown>) =>
        run(manager),
      ),
      query: jest.fn().mockResolvedValue([{ max: null }]),
      create: jest.fn((_entity: unknown, payload: unknown) => payload),
      save: jest.fn((payload: Record<string, unknown>) =>
        Promise.resolve({ id: REQUEST_ID, ...payload }),
      ),
    };

    const repository = {
      manager,
      createQueryBuilder: jest.fn(() => repoBuilder.self),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestsService,
        { provide: getRepositoryToken(RequestEntity), useValue: repository },
      ],
    }).compile();

    service = module.get(RequestsService);
  });

  describe('update', () => {
    it('folds the membership test into the UPDATE rather than checking first', () => {
      // The row is never loaded, so there is no interval in which membership
      // could change between the read and the write.
      return service.update(USER, REQUEST_ID, { name: 'renamed' }).then(() => {
        const [update] = repoBuilder.calls;
        expect(update.sql).toContain('"id" = :id');
        expect(update.sql).toContain('"collectionId" IN (');
        expect(update.sql).toContain('"workspace_members"');
        expect(update.params).toMatchObject({
          id: REQUEST_ID,
          userId: USER,
          roles: ['OWNER', 'ADMIN', 'EDITOR'],
        });
      });
    });

    it('excludes VIEWER from the roles it binds', async () => {
      await service.update(USER, REQUEST_ID, { name: 'renamed' });

      expect(repoBuilder.calls[0].params.roles).not.toContain('VIEWER');
    });

    it('skips the statement entirely when the patch is empty', async () => {
      await service.update(USER, REQUEST_ID, {});

      expect(repoBuilder.self.execute).not.toHaveBeenCalled();
    });

    it('answers 403 when the row is readable but the role is too low', async () => {
      repoBuilder.self.execute.mockResolvedValue({ affected: 0 });
      // The denial probe re-asks under READ_ROLES and finds it.
      managerBuilder.self.getExists.mockResolvedValue(true);

      await expect(
        service.update(USER, REQUEST_ID, { name: 'x' }),
      ).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
        response: { code: ApiErrorCode.FORBIDDEN },
      });

      expect(managerBuilder.calls[0].params.roles).toEqual([
        'OWNER',
        'ADMIN',
        'EDITOR',
        'VIEWER',
      ]);
    });

    it('answers 404 when the row is not visible at all', async () => {
      // A 403 here would confirm the id is real and let anyone enumerate what
      // exists across the whole system.
      repoBuilder.self.execute.mockResolvedValue({ affected: 0 });
      managerBuilder.self.getExists.mockResolvedValue(false);

      await expect(
        service.update(USER, REQUEST_ID, { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('scopes the DELETE the same way, in one statement', async () => {
      await service.remove(USER, REQUEST_ID);

      expect(repoBuilder.calls[0].sql).toContain('"collectionId" IN (');
      expect(repoBuilder.calls[0].params).toMatchObject({ userId: USER });
    });

    it('turns a delete that touched nothing into the right status', async () => {
      repoBuilder.self.execute.mockResolvedValue({ affected: 0 });
      managerBuilder.self.getExists.mockResolvedValue(false);

      await expect(service.remove(USER, REQUEST_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it("resolves the BODY's collectionId through the scoped query, inside the transaction", async () => {
      // ⚠️ The assertion this file exists for. On POST the parent id is in the
      // body, which is exactly where a route-param guard cannot see it — so
      // this is the one path where copying the scoped-UPDATE shape would leave
      // a full cross-tenant write unauthorized.
      await service.create(USER, { collectionId: COLLECTION_ID, name: 'ping' });

      expect(manager.transaction).toHaveBeenCalledTimes(1);

      const scoped = managerBuilder.calls[0];
      expect(scoped.sql).toContain('c."id" = :collectionId');
      expect(scoped.sql).toContain('"workspace_members"');
      expect(scoped.params).toMatchObject({
        collectionId: COLLECTION_ID,
        userId: USER,
        roles: ['OWNER', 'ADMIN', 'EDITOR'],
      });
    });

    it('denies on the PARENT, 403 when the collection is readable', async () => {
      // `explainDenial` cannot be reused: no request id exists yet. The answer
      // is keyed on the collection, because that is what the caller named.
      managerBuilder.self.getExists
        .mockResolvedValueOnce(false) // the scoped WRITE resolve finds nothing
        .mockResolvedValueOnce(true); // but the READ probe does

      await expect(
        service.create(USER, { collectionId: COLLECTION_ID, name: 'ping' }),
      ).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
        response: { code: ApiErrorCode.FORBIDDEN },
      });
    });

    it('denies on the PARENT, 404 when the collection is invisible', async () => {
      managerBuilder.self.getExists.mockResolvedValue(false);

      // The message names the collection — the id the caller actually supplied
      // — rather than a request id, which does not exist yet.
      await expect(
        service.create(USER, { collectionId: COLLECTION_ID, name: 'ping' }),
      ).rejects.toThrow(COLLECTION_ID);
    });

    it('never inserts when the parent resolve failed', async () => {
      managerBuilder.self.getExists.mockResolvedValue(false);

      await expect(
        service.create(USER, { collectionId: COLLECTION_ID, name: 'ping' }),
      ).rejects.toBeDefined();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('computes the sibling position with IS NOT DISTINCT FROM, not =', async () => {
      // ⚠️ `"folderId" = $2` with $2 NULL is never true, so every root-level
      // request would see zero siblings and stack on top of the others.
      await service.create(USER, { collectionId: COLLECTION_ID, name: 'ping' });

      const [sql, params] = manager.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('IS NOT DISTINCT FROM');
      expect(sql).not.toMatch(/"folderId" = \$/);
      expect(params).toEqual([COLLECTION_ID, null]);
    });

    it('applies the documented defaults for an otherwise bare request', async () => {
      await service.create(USER, { collectionId: COLLECTION_ID, name: 'ping' });

      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: '',
          body: { mode: 'none' },
          auth: { type: 'inherit' },
          headers: [],
          queryParams: [],
          position: 1024,
        }),
      );
    });
  });

  describe('move', () => {
    it('resolves the TARGET folder through the scoped source, not on its own', async () => {
      // Both parents have to be authorized. A guard on `:id` would authorize
      // the source and wave the destination straight through.
      managerBuilder.self.getRawOne.mockResolvedValue({
        collectionId: COLLECTION_ID,
      });
      manager.query.mockImplementation((sql: string): Promise<unknown[]> =>
        sql.includes('FROM "folders"')
          ? Promise.resolve([{ '?column?': 1 }])
          : Promise.resolve([]),
      );

      await service.move(USER, REQUEST_ID, { folderId: 'folder-9' });

      const folderCheck = manager.query.mock.calls.find(([sql]: [string]) =>
        sql.includes('FROM "folders"'),
      ) as [string, unknown[]];
      // Constrained to the collection the *scoped* source read returned, so a
      // folder in someone else's collection can never match.
      expect(folderCheck[1]).toEqual(['folder-9', COLLECTION_ID]);
    });

    it('rejects a target folder in another collection as not found', async () => {
      managerBuilder.self.getRawOne.mockResolvedValue({
        collectionId: COLLECTION_ID,
      });
      manager.query.mockResolvedValue([]); // no such folder here

      await expect(
        service.move(USER, REQUEST_ID, { folderId: 'folder-elsewhere' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
