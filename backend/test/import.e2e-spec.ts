import { INestApplication } from '@nestjs/common';
import { THROTTLER_OPTIONS } from '@nestjs/throttler/dist/throttler.constants';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ApiErrorCode,
  IMPORT_MAX_ITEMS,
  type ApiRequest,
  type ImportCollectionResult,
  type ImportEnvironmentResult,
  type WorkspaceTree,
} from '@raven/contracts';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import v20 from '../src/import/fixtures/collection-v2.0.json';
import v21 from '../src/import/fixtures/collection-v2.1.json';
import environmentFixture from '../src/import/fixtures/environment.json';

/**
 * Postman import, end to end.
 *
 * Modelled on `workspaces.e2e-spec.ts`: `e2e-import-` addresses, a per-run id,
 * and an `afterAll` that deletes by that prefix — which also sweeps up after a
 * run killed before its teardown. Deleting the users is the whole cleanup:
 * workspaces cascade from `users`, and collections, folders, requests and
 * environments each cascade from `workspaces`.
 *
 * ⚠️ **This suite creates its app with `{ bodyParser: false }`, and it is the
 * only one that does.** Nest installs its own 100 kB JSON parser unless told
 * not to, and it runs *before* the one `configureApp` adds — so in every other
 * suite `configureApp`'s `IMPORT_MAX_BYTES` limit is present but unreachable.
 * Opting out here is what makes the oversize case below assert on the real
 * production limit rather than on Nest's default. The asymmetry is deliberate:
 * the other suites post small bodies and gain nothing from diverging from the
 * default, and `main.ts` matches *this* spelling, not theirs.
 */

const EMAIL_PREFIX = 'e2e-import-';
const EMAIL_DOMAIN = '@example.test';
const PASSWORD = 'Password123!';

interface Ident {
  token: string;
  userId: string;
  workspaceId: string;
}

function errorBody(res: request.Response): { code: string; message: string } {
  return (res.body as { error: { code: string; message: string } }).error;
}

describe('Postman import (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let server: App;

  let counter = 0;
  const runId = `${process.pid.toString(36)}${Date.now().toString(36)}`;
  const freshEmail = () =>
    `${EMAIL_PREFIX}${runId}-${counter++}${EMAIL_DOMAIN}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Registers several accounts in quick succession; raised through the
      // provider token because `ConfigModule` reads the environment at
      // decorator-evaluation time. All four windows — see `register.e2e-spec`.
      .overrideProvider(THROTTLER_OPTIONS)
      .useValue({
        throttlers: [
          { name: 'burst', ttl: 60000, limit: 500 },
          { name: 'sustained', ttl: 3600000, limit: 500 },
          { name: 'sendBurst', ttl: 60000, limit: 500 },
          { name: 'sendSustained', ttl: 3600000, limit: 500 },
        ],
      })
      .compile();

    // ⚠️ See the suite note: this is what puts `configureApp`'s import-sized
    // body limit in charge instead of Nest's 100 kB default.
    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM "users" WHERE "email" LIKE $1`, [
      `${EMAIL_PREFIX}%`,
    ]);
    await app.close();
  });

  async function signUp(): Promise<Ident> {
    const res = await request(server)
      .post('/api/v1/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send({
        email: freshEmail(),
        name: 'E2E Import User',
        password: PASSWORD,
      })
      .expect(201);

    const token = (res.body as { accessToken: string }).accessToken;
    const userId = (res.body as { user: { id: string } }).user.id;

    const workspaces = await request(server)
      .get('/api/v1/workspaces')
      .auth(token, { type: 'bearer' })
      .expect(200);

    return {
      token,
      userId,
      workspaceId: (workspaces.body as { data: { id: string }[] }).data[0].id,
    };
  }

  const as = (ident: Ident) => ({
    get: (url: string) =>
      request(server).get(url).auth(ident.token, { type: 'bearer' }),
    post: (url: string, body: unknown) =>
      request(server)
        .post(url)
        .auth(ident.token, { type: 'bearer' })
        .send(body as object),
  });

  const importV21 = async (ident: Ident): Promise<ImportCollectionResult> => {
    const res = await as(ident)
      .post('/api/v1/import/collection', {
        workspaceId: ident.workspaceId,
        data: v21,
      })
      .expect(201);
    return res.body as ImportCollectionResult;
  };

  // ------------------------------------------------------------- happy path

  describe('importing a collection', () => {
    let user: Ident;
    let result: ImportCollectionResult;

    beforeAll(async () => {
      user = await signUp();
      result = await importV21(user);
    });

    it('answers 201 with the collection, counts and warnings', () => {
      expect(result.collection.name).toBe('Raven Import Fixture');
      expect(result.collection.workspaceId).toBe(user.workspaceId);
      // 4 folders (Auth, Nested, Bodies, Edge cases) and 15 requests.
      expect(result.folderCount).toBe(4);
      expect(result.requestCount).toBe(15);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('returns the collection through its response DTO, dates as ISO strings', () => {
      // Never a bare entity: `createdAt` would be a Date, and the entity would
      // carry the relation object rather than `workspaceId`.
      expect(typeof result.collection.createdAt).toBe('string');
      expect(new Date(result.collection.createdAt).toString()).not.toBe(
        'Invalid Date',
      );
    });

    it('stores the collection-level auth and variables the new columns exist for', () => {
      expect(result.collection.auth).toEqual({
        type: 'bearer',
        token: '{{collectionToken}}',
      });
      expect(
        result.collection.variables.find((v) => v.key === 'baseUrl'),
      ).toEqual({
        key: 'baseUrl',
        value: 'https://api.example.com',
        enabled: true,
      });
    });

    it('carries every warning kind the fixture provokes', () => {
      const kinds = new Set(result.warnings.map((warning) => warning.kind));
      for (const kind of [
        'unsupported-auth',
        'unsupported-body',
        'unsupported-method',
        'folder-auth-dropped',
        'folder-variables-merged',
        'variable-conflict',
        'collection-script-dropped',
        'path-variables',
        'examples-dropped',
        'file-placeholder',
      ]) {
        expect([...kinds]).toContain(kind);
      }
    });

    it('shows the imported structure in the tree, nesting and order intact', async () => {
      const res = await as(user)
        .get(`/api/v1/workspaces/${user.workspaceId}/tree`)
        .expect(200);

      const tree = res.body as WorkspaceTree;
      const collection = tree.collections.find(
        (row) => row.id === result.collection.id,
      );
      expect(collection).toBeDefined();

      // Root order follows the file: one request, then three folders.
      expect(collection!.requests.map((row) => row.name)).toEqual(['Ping']);
      expect(collection!.folders.map((row) => row.name)).toEqual([
        'Auth',
        'Bodies',
        'Edge cases',
      ]);

      // ⚠️ The depth-ordered insert is what makes this row exist at all: the
      // composite FK_folders_parent rejects a child written before its parent.
      const auth = collection!.folders[0];
      expect(auth.folders.map((row) => row.name)).toEqual(['Nested']);
      expect(auth.folders[0].requests.map((row) => row.name)).toEqual([
        'Deep request',
      ]);
      expect(auth.requests.map((row) => row.name)).toEqual([
        'Login',
        'Refresh',
      ]);
    });

    it('round-trips a request whole through GET /requests/:id', async () => {
      const tree = (
        await as(user)
          .get(`/api/v1/workspaces/${user.workspaceId}/tree`)
          .expect(200)
      ).body as WorkspaceTree;

      const collection = tree.collections.find(
        (row) => row.id === result.collection.id,
      )!;
      const login = collection.folders[0].requests.find(
        (row) => row.name === 'Login',
      )!;

      const res = await as(user)
        .get(`/api/v1/requests/${login.id}`)
        .expect(200);
      const saved = res.body as ApiRequest;

      expect(saved.method).toBe('POST');
      expect(saved.url).toBe('{{baseUrl}}/login');
      expect(saved.body).toEqual({
        mode: 'json',
        text: '{\n  "email": "a@b.c"\n}',
      });
      expect(saved.auth).toEqual({ type: 'none' });
      // ⚠️ `pm.` was rewritten to `rv.` on the way in, and survived the jsonb
      // column round trip.
      expect(saved.scripts.preRequest).toContain("rv.variables.set('a', 1)");
      expect(saved.scripts.preRequest).not.toContain('pm.');
      expect(saved.scripts.postRequest).toContain('rv.response.to.have.status');
    });

    it('round-trips each new body mode and the unsupported auth variant', async () => {
      const tree = (
        await as(user)
          .get(`/api/v1/workspaces/${user.workspaceId}/tree`)
          .expect(200)
      ).body as WorkspaceTree;

      const collection = tree.collections.find(
        (row) => row.id === result.collection.id,
      )!;
      const bodies = collection.folders.find((row) => row.name === 'Bodies')!;
      const byName = new Map(bodies.requests.map((row) => [row.name, row.id]));

      const load = async (name: string): Promise<ApiRequest> =>
        (
          await as(user)
            .get(`/api/v1/requests/${byName.get(name)!}`)
            .expect(200)
        ).body as ApiRequest;

      expect((await load('XML body')).body).toEqual({
        mode: 'xml',
        text: '<a>1</a>',
      });
      expect((await load('GraphQL body')).body).toEqual({
        mode: 'graphql',
        query: 'query Q($id: ID!) { user(id: $id) { name } }',
        variables: '{"id": "1"}',
      });
      expect((await load('Form-data body')).body).toEqual({
        mode: 'form-data',
        entries: [
          { key: 'caption', value: 'hi', enabled: true, type: 'text' },
          {
            key: 'avatar',
            value: '/Users/someone/avatar.png',
            enabled: true,
            type: 'file',
          },
        ],
      });
      expect((await load('Binary body')).body).toEqual({
        mode: 'binary',
        src: '/Users/someone/data.bin',
      });

      const refresh = collection.folders
        .find((row) => row.name === 'Auth')!
        .requests.find((row) => row.name === 'Refresh')!;
      const stored = (
        await as(user).get(`/api/v1/requests/${refresh.id}`).expect(200)
      ).body as ApiRequest;
      expect(stored.auth).toEqual({
        type: 'unsupported',
        scheme: 'oauth2',
        params: [
          { key: 'accessToken', value: 'abc123', enabled: true },
          { key: 'tokenType', value: 'bearer', enabled: true },
        ],
      });
    });

    it('appends a second import after the first, rather than colliding', async () => {
      const second = await importV21(user);
      expect(second.collection.position).toBeGreaterThan(
        result.collection.position,
      );
      expect(second.collection.id).not.toBe(result.collection.id);
    });

    it('accepts a v2.0 export too', async () => {
      const other = await signUp();
      const res = await as(other)
        .post('/api/v1/import/collection', {
          workspaceId: other.workspaceId,
          data: v20,
        })
        .expect(201);

      const body = res.body as ImportCollectionResult;
      expect(body.collection.name).toBe('Legacy Export');
      expect(body.requestCount).toBe(2);
      expect(body.folderCount).toBe(0);
    });
  });

  // ------------------------------------------------------------ environments

  describe('importing an environment', () => {
    it('creates the environment, keeping the secret flag and disabled rows', async () => {
      const user = await signUp();

      const res = await as(user)
        .post('/api/v1/import/environment', {
          workspaceId: user.workspaceId,
          data: environmentFixture,
        })
        .expect(201);

      const body = res.body as ImportEnvironmentResult;
      expect(body.environment.name).toBe('Staging');
      expect(body.warnings).toEqual([]);
      expect(body.environment.variables).toEqual([
        {
          key: 'baseUrl',
          value: 'https://staging.example.com',
          enabled: true,
        },
        { key: 'apiKey', value: 'sk-live-123', enabled: true, secret: true },
        { key: 'retired', value: 'x', enabled: false },
        { key: 'port', value: '8080', enabled: true },
        { key: 'novalue', value: '', enabled: true },
      ]);

      // It is a real environment, visible to the list endpoint like any other.
      const list = await as(user)
        .get(`/api/v1/workspaces/${user.workspaceId}/environments`)
        .expect(200);
      expect(
        (list.body as { data: { id: string }[] }).data.map((row) => row.id),
      ).toContain(body.environment.id);
    });

    it('imports a globals export as an environment, and warns', async () => {
      const user = await signUp();

      const res = await as(user)
        .post('/api/v1/import/environment', {
          workspaceId: user.workspaceId,
          data: {
            values: [{ key: 'g', value: '1', enabled: true }],
            _postman_variable_scope: 'globals',
          },
        })
        .expect(201);

      const body = res.body as ImportEnvironmentResult;
      expect(body.environment.name).toBe('Postman globals');
      expect(body.warnings.map((warning) => warning.kind)).toEqual([
        'globals-as-environment',
      ]);
    });
  });

  // -------------------------------------------------------------- authorization

  describe('tenancy', () => {
    it('404s a workspace the caller is not a member of', async () => {
      const owner = await signUp();
      const stranger = await signUp();

      // ⚠️ 404, not 403: a 403 would confirm the id is real, which is all an
      // attacker needs to enumerate. And the id is in the *body*, which is
      // exactly where a route-param guard would have seen nothing to check.
      const res = await as(stranger)
        .post('/api/v1/import/collection', {
          workspaceId: owner.workspaceId,
          data: v21,
        })
        .expect(404);

      expect(errorBody(res).code).toBe(ApiErrorCode.NOT_FOUND);
    });

    it('writes nothing into a workspace the caller cannot see', async () => {
      const owner = await signUp();
      const stranger = await signUp();

      await as(stranger)
        .post('/api/v1/import/collection', {
          workspaceId: owner.workspaceId,
          data: v21,
        })
        .expect(404);

      const rows = await dataSource.query<{ count: string }[]>(
        `SELECT COUNT(*)::int AS count FROM "collections" WHERE "workspaceId" = $1`,
        [owner.workspaceId],
      );
      expect(Number(rows[0].count)).toBe(0);
    });

    it('403s a VIEWER, who can see the workspace but not write to it', async () => {
      const owner = await signUp();
      const viewer = await signUp();

      await dataSource.query(
        `INSERT INTO "workspace_members" ("workspaceId", "userId", "role") VALUES ($1, $2, 'VIEWER')`,
        [owner.workspaceId, viewer.userId],
      );

      // 403 rather than 404: they can already read this workspace, so the
      // status leaks nothing and a 404 would be a lie.
      for (const path of ['collection', 'environment']) {
        const res = await as(viewer)
          .post(`/api/v1/import/${path}`, {
            workspaceId: owner.workspaceId,
            data: path === 'collection' ? v21 : environmentFixture,
          })
          .expect(403);
        expect(errorBody(res).code).toBe(ApiErrorCode.FORBIDDEN);
      }
    });

    it('401s an unauthenticated caller — the route is protected by default', async () => {
      await request(server)
        .post('/api/v1/import/collection')
        .send({
          workspaceId: '00000000-0000-4000-8000-000000000000',
          data: v21,
        })
        .expect(401);
    });
  });

  // ---------------------------------------------------------------- rejection

  describe('documents it refuses', () => {
    let user: Ident;
    beforeAll(async () => {
      user = await signUp();
    });

    const rejected = async (data: unknown, contains: string) => {
      const res = await as(user)
        .post('/api/v1/import/collection', {
          workspaceId: user.workspaceId,
          data,
        })
        .expect(400);

      expect(errorBody(res).code).toBe(ApiErrorCode.VALIDATION_FAILED);
      // The message is on the `data` field detail — one constraint, one
      // message, exactly as `postman-constraints.ts` intends.
      const detail = (
        res.body as { error: { details: { field: string; message: string }[] } }
      ).error.details.find((row) => row.field === 'data');
      expect(detail?.message).toContain(contains);
    };

    it('400s a v1 collection by its schema', async () => {
      await rejected(
        {
          info: {
            name: 'old',
            schema:
              'https://schema.getpostman.com/json/collection/v1.0.0/collection.json',
          },
          item: [],
        },
        'v2.0 or v2.1',
      );
    });

    it('400s a document with no schema at all', async () => {
      await rejected({ info: { name: 'x' }, item: [] }, 'info.schema');
    });

    it('400s an OpenAPI document, which is the likely wrong file', async () => {
      await rejected({ openapi: '3.0.0', paths: {} }, 'info');
    });

    it('400s a document over the item cap', async () => {
      await rejected(
        {
          info: {
            name: 'big',
            schema:
              'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
          },
          item: Array.from({ length: IMPORT_MAX_ITEMS + 1 }, () => ({
            name: 'r',
            request: {},
          })),
        },
        String(IMPORT_MAX_ITEMS),
      );
    });

    it('400s an environment document posted to the collection route', async () => {
      await rejected(environmentFixture, 'info');
    });

    it('400s a collection document posted to the environment route', async () => {
      const res = await as(user)
        .post('/api/v1/import/environment', {
          workspaceId: user.workspaceId,
          data: v21,
        })
        .expect(400);
      expect(errorBody(res).code).toBe(ApiErrorCode.VALIDATION_FAILED);
    });

    it('413s a body over the import size limit', async () => {
      // ⚠️ Only meaningful because this suite's app was built with
      // `{ bodyParser: false }` — see the note at the top. With Nest's own
      // parser in place this would 413 at 100 kB and prove nothing about the
      // production limit.
      const huge = 'x'.repeat(11 * 1024 * 1024);
      await as(user)
        .post('/api/v1/import/collection', {
          workspaceId: user.workspaceId,
          data: { info: { name: huge }, item: [] },
        })
        .expect(413);
    });

    it("accepts a body comfortably over Nest's 100 kB default", async () => {
      // The other half of the same point: the raised limit is real, not just
      // permissive at the top end.
      const padded = {
        ...v21,
        info: { ...v21.info, description: 'y'.repeat(300 * 1024) },
      };
      await as(user)
        .post('/api/v1/import/collection', {
          workspaceId: user.workspaceId,
          data: padded,
        })
        .expect(201);
    });
  });
});
