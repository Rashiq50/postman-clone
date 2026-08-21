import { INestApplication } from '@nestjs/common';
import { THROTTLER_OPTIONS } from '@nestjs/throttler/dist/throttler.constants';
import { Test, TestingModule } from '@nestjs/testing';
import { ApiErrorCode, type WorkspaceTree } from '@postman-clone/contracts';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';

/**
 * The domain slice end to end: provisioning, the tree, ordering, and above all
 * the cross-tenant isolation that the SQL-scoped design exists to provide.
 *
 * Cleanup follows `register.e2e-spec.ts`: every address carries the
 * `EMAIL_PREFIX` marker plus a per-run id, and `afterAll` deletes by that
 * prefix — which also sweeps up after a run killed before its teardown.
 *
 * ⚠️ Deleting the *users* is all the cleanup this suite needs, and that is a
 * design consequence rather than luck: `workspaces.ownerUserId` cascades from
 * `users`, and collections, folders, requests and environments each cascade
 * from `workspaces`. Removing one row removes the whole subtree. (That same
 * cascade is what §1.1 flags as needing to become RESTRICT the moment
 * workspace sharing lands — at which point this teardown must change with it.)
 *
 * ⚠️ It must never touch the seed user, and the suite runs `--runInBand`
 * alongside the other e2e specs against the development database.
 */

const EMAIL_PREFIX = 'e2e-workspace-';
const EMAIL_DOMAIN = '@example.test';
const PASSWORD = 'Password123!';

interface Ident {
  email: string;
  token: string;
  userId: string;
  workspaceId: string;
}

function errorBody(res: request.Response): {
  code: string;
  message: string;
  details?: { field: string; message: string }[];
} {
  return (res.body as { error: ReturnType<typeof errorBody> }).error;
}

describe('Workspaces, collections and requests (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let server: App;

  let counter = 0;
  const runId = `${process.pid.toString(36)}${Date.now().toString(36)}`;
  const freshEmail = () =>
    `${EMAIL_PREFIX}${runId}-${counter++}${EMAIL_DOMAIN}`;

  beforeAll(async () => {
    // Registers a handful of accounts in quick succession — the shape
    // `POST /auth/register` is throttled against. Raised rather than skipped,
    // via the provider token: `ConfigModule.forRoot()` reads the environment
    // when the `@Module` decorator is evaluated, so setting `process.env` here
    // would always be too late.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(THROTTLER_OPTIONS)
      // All four registered windows — see the note in `register.e2e-spec.ts`.
      .useValue({
        throttlers: [
          { name: 'burst', ttl: 60000, limit: 500 },
          { name: 'sustained', ttl: 3600000, limit: 500 },
          { name: 'sendBurst', ttl: 60000, limit: 500 },
          { name: 'sendSustained', ttl: 3600000, limit: 500 },
        ],
      })
      .compile();

    app = moduleFixture.createNestApplication();
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

  /**
   * A direct row count, going past the API on purpose: the API filters by
   * collection either way, so it would report a successful cascade even if
   * every row were still sitting there.
   */
  async function countRows(sql: string, params: unknown[]): Promise<number> {
    const rows = await dataSource.query<{ count: number }[]>(sql, params);
    return rows[0].count;
  }

  /** Registers a user and returns their token and personal workspace. */
  async function signUp(): Promise<Ident> {
    const email = freshEmail();
    const res = await request(server)
      .post('/api/v1/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send({ email, name: 'E2E Workspace User', password: PASSWORD })
      .expect(201);

    const token = (res.body as { accessToken: string }).accessToken;
    const userId = (res.body as { user: { id: string } }).user.id;

    const workspaces = await request(server)
      .get('/api/v1/workspaces')
      .auth(token, { type: 'bearer' })
      .expect(200);

    const workspaceId = (workspaces.body as { data: { id: string }[] }).data[0]
      .id;

    return { email, token, userId, workspaceId };
  }

  const as = (ident: Ident) => ({
    get: (url: string) =>
      request(server).get(url).auth(ident.token, { type: 'bearer' }),
    post: (url: string, body: unknown) =>
      request(server)
        .post(url)
        .auth(ident.token, { type: 'bearer' })
        .send(body as object),
    patch: (url: string, body: unknown) =>
      request(server)
        .patch(url)
        .auth(ident.token, { type: 'bearer' })
        .send(body as object),
    delete: (url: string) =>
      request(server).delete(url).auth(ident.token, { type: 'bearer' }),
  });

  // ------------------------------------------------------------ provisioning

  describe('personal workspace provisioning', () => {
    it('gives a brand-new account exactly one personal workspace it owns', async () => {
      // The whole point of putting provisioning inside the user-creation
      // transaction: a user with no workspace is a silently broken account
      // with no repair path.
      const user = await signUp();

      const res = await as(user).get('/api/v1/workspaces').expect(200);
      const body = res.body as {
        data: {
          id: string;
          isPersonal: boolean;
          role: string;
          organizationId: string | null;
          ownerUserId: string;
        }[];
        meta: { total: number };
      };

      expect(body.data).toHaveLength(1);
      expect(body.meta.total).toBe(1);
      expect(body.data[0].isPersonal).toBe(true);
      expect(body.data[0].role).toBe('OWNER');
      expect(body.data[0].ownerUserId).toBe(user.userId);
      // The organization seam: present, nullable, and null.
      expect(body.data[0].organizationId).toBeNull();
    });

    it('is a real list, so it keeps the { data, meta } envelope', async () => {
      const user = await signUp();

      const res = await as(user).get('/api/v1/workspaces').expect(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('meta');
    });
  });

  // -------------------------------------------------------------- empty tree

  describe('the tree', () => {
    it('answers an empty workspace with an empty collection list', async () => {
      const user = await signUp();

      const res = await as(user)
        .get(`/api/v1/workspaces/${user.workspaceId}/tree`)
        .expect(200);

      expect(res.body).toEqual({
        workspaceId: user.workspaceId,
        collections: [],
      });
    });

    it('has NO meta key — it is a single resource, not a list', async () => {
      // Pins the decision against a future "consistency" fix that wraps this
      // in a pagination envelope. Half a tree is not a tree.
      const user = await signUp();

      const res = await as(user)
        .get(`/api/v1/workspaces/${user.workspaceId}/tree`)
        .expect(200);

      expect(res.body).not.toHaveProperty('meta');
      expect(res.body).not.toHaveProperty('data');
    });

    it('nests collection → folder → nested folder → request at every level', async () => {
      const user = await signUp();

      const collection = await as(user)
        .post('/api/v1/collections', {
          workspaceId: user.workspaceId,
          name: 'My API',
        })
        .expect(201);
      const collectionId = (collection.body as { id: string }).id;

      const outer = await as(user)
        .post('/api/v1/folders', { collectionId, name: 'v1' })
        .expect(201);
      const outerId = (outer.body as { id: string }).id;

      const inner = await as(user)
        .post('/api/v1/folders', {
          collectionId,
          parentFolderId: outerId,
          name: 'users',
        })
        .expect(201);
      const innerId = (inner.body as { id: string }).id;

      await as(user)
        .post('/api/v1/requests', { collectionId, name: 'at-collection-root' })
        .expect(201);
      await as(user)
        .post('/api/v1/requests', {
          collectionId,
          folderId: outerId,
          name: 'in-outer',
        })
        .expect(201);
      await as(user)
        .post('/api/v1/requests', {
          collectionId,
          folderId: innerId,
          name: 'in-inner',
          method: 'POST',
        })
        .expect(201);

      const res = await as(user)
        .get(`/api/v1/workspaces/${user.workspaceId}/tree`)
        .expect(200);
      const tree = res.body as WorkspaceTree;

      expect(tree.collections).toHaveLength(1);
      const [root] = tree.collections;
      expect(root.requests.map((r) => r.name)).toEqual(['at-collection-root']);
      expect(root.folders.map((f) => f.name)).toEqual(['v1']);

      const [v1] = root.folders;
      expect(v1.requests.map((r) => r.name)).toEqual(['in-outer']);
      expect(v1.folders.map((f) => f.name)).toEqual(['users']);
      expect(v1.folders[0].requests.map((r) => r.name)).toEqual(['in-inner']);
      // The sidebar badge comes from the tree, so the method has to be there.
      expect(v1.folders[0].requests[0].method).toBe('POST');
    });

    it('carries only the sidebar skeleton, never the request body or auth', async () => {
      // What makes fetching the whole workspace eagerly the cheaper design.
      const user = await signUp();
      const collection = await as(user)
        .post('/api/v1/collections', {
          workspaceId: user.workspaceId,
          name: 'C',
        })
        .expect(201);

      await as(user)
        .post('/api/v1/requests', {
          collectionId: (collection.body as { id: string }).id,
          name: 'r',
          url: 'https://example.com/secret',
          auth: { type: 'bearer', token: 'do-not-leak-into-the-tree' },
        })
        .expect(201);

      const res = await as(user)
        .get(`/api/v1/workspaces/${user.workspaceId}/tree`)
        .expect(200);

      const node = (res.body as WorkspaceTree).collections[0].requests[0];
      expect(Object.keys(node).sort()).toEqual(
        ['folderId', 'id', 'method', 'name', 'position'].sort(),
      );
      expect(JSON.stringify(res.body)).not.toContain(
        'do-not-leak-into-the-tree',
      );
    });
  });

  // ------------------------------------------------------ cross-tenant tests

  describe('cross-tenant isolation', () => {
    let alice: Ident;
    let bob: Ident;
    let aliceCollectionId: string;
    let aliceFolderId: string;
    let aliceRequestId: string;

    beforeAll(async () => {
      alice = await signUp();
      bob = await signUp();

      const collection = await as(alice)
        .post('/api/v1/collections', {
          workspaceId: alice.workspaceId,
          name: "Alice's API",
        })
        .expect(201);
      aliceCollectionId = (collection.body as { id: string }).id;

      const folder = await as(alice)
        .post('/api/v1/folders', {
          collectionId: aliceCollectionId,
          name: 'private',
        })
        .expect(201);
      aliceFolderId = (folder.body as { id: string }).id;

      const req = await as(alice)
        .post('/api/v1/requests', {
          collectionId: aliceCollectionId,
          name: 'secret',
        })
        .expect(201);
      aliceRequestId = (req.body as { id: string }).id;
    });

    it("404s Bob on every verb against Alice's request", async () => {
      // 404 rather than 403 throughout: a 403 would confirm the id is real,
      // which is all an attacker needs to enumerate what exists.
      await as(bob).get(`/api/v1/requests/${aliceRequestId}`).expect(404);
      await as(bob)
        .patch(`/api/v1/requests/${aliceRequestId}`, { name: 'pwned' })
        .expect(404);
      await as(bob).delete(`/api/v1/requests/${aliceRequestId}`).expect(404);
    });

    it("404s Bob on Alice's tree", async () => {
      await as(bob)
        .get(`/api/v1/workspaces/${alice.workspaceId}/tree`)
        .expect(404);
    });

    it("404s a POST /requests into Alice's collection", async () => {
      // ⚠️ The most important assertion in this file. The parent id lives in
      // the *body*, so a guard keyed on route params sees nothing to check and
      // waves this straight through — a full cross-tenant write. Only
      // authorization inside the statement catches it.
      await as(bob)
        .post('/api/v1/requests', {
          collectionId: aliceCollectionId,
          name: 'planted',
        })
        .expect(404);
    });

    it("404s a POST /folders and /collections into Alice's parents", async () => {
      await as(bob)
        .post('/api/v1/folders', {
          collectionId: aliceCollectionId,
          name: 'planted',
        })
        .expect(404);
      await as(bob)
        .post('/api/v1/collections', {
          workspaceId: alice.workspaceId,
          name: 'planted',
        })
        .expect(404);
    });

    it("404s a move of Bob's own request into Alice's folder", async () => {
      // The destination is the half a route-param guard cannot see. For this
      // to fail for the *right* reason, the handler must resolve the target
      // folder through the scoped query before the same-collection check —
      // an unscoped resolve would 404 here too, and the test would pass while
      // the hole stayed open.
      const bobCollection = await as(bob)
        .post('/api/v1/collections', {
          workspaceId: bob.workspaceId,
          name: "Bob's API",
        })
        .expect(201);
      const bobRequest = await as(bob)
        .post('/api/v1/requests', {
          collectionId: (bobCollection.body as { id: string }).id,
          name: 'mine',
        })
        .expect(201);

      await as(bob)
        .patch(
          `/api/v1/requests/${(bobRequest.body as { id: string }).id}/move`,
          {
            folderId: aliceFolderId,
          },
        )
        .expect(404);
    });

    it("does not show Alice's workspace in Bob's list", async () => {
      const res = await as(bob).get('/api/v1/workspaces').expect(200);
      const ids = (res.body as { data: { id: string }[] }).data.map(
        (w) => w.id,
      );

      expect(ids).not.toContain(alice.workspaceId);
    });
  });

  // ------------------------------------------------------------- the VIEWER

  describe('the role seam', () => {
    let owner: Ident;
    let viewer: Ident;
    let collectionId: string;
    let requestId: string;

    beforeAll(async () => {
      owner = await signUp();
      viewer = await signUp();

      const collection = await as(owner)
        .post('/api/v1/collections', {
          workspaceId: owner.workspaceId,
          name: 'Shared',
        })
        .expect(201);
      collectionId = (collection.body as { id: string }).id;

      const req = await as(owner)
        .post('/api/v1/requests', { collectionId, name: 'readable' })
        .expect(201);
      requestId = (req.body as { id: string }).id;

      // Inserted directly: there is deliberately no invite endpoint in this
      // slice, and no UI for one. Without this case the `roles` array threaded
      // through every query is decoration that has never been observed doing
      // anything.
      await dataSource.query(
        `INSERT INTO "workspace_members" ("workspaceId", "userId", "role") VALUES ($1, $2, 'VIEWER')`,
        [owner.workspaceId, viewer.userId],
      );
    });

    it('lets a VIEWER read the tree', async () => {
      const res = await as(viewer)
        .get(`/api/v1/workspaces/${owner.workspaceId}/tree`)
        .expect(200);

      expect((res.body as WorkspaceTree).collections).toHaveLength(1);
    });

    it('403s a VIEWER writing, rather than 404ing', async () => {
      // A 403 leaks nothing here — they can already read the row — and a 404
      // would tell a VIEWER their own request does not exist.
      const res = await as(viewer)
        .patch(`/api/v1/requests/${requestId}`, { name: 'edited' })
        .expect(403);

      expect(errorBody(res).code).toBe(ApiErrorCode.FORBIDDEN);
    });

    it('403s a VIEWER creating inside a collection they can see', async () => {
      const res = await as(viewer)
        .post('/api/v1/requests', { collectionId, name: 'nope' })
        .expect(403);

      expect(errorBody(res).code).toBe(ApiErrorCode.FORBIDDEN);
    });

    it('403s a VIEWER deleting', async () => {
      await as(viewer).delete(`/api/v1/requests/${requestId}`).expect(403);
    });

    it('shows the VIEWER their role on the workspace', async () => {
      const res = await as(viewer).get('/api/v1/workspaces').expect(200);
      const shared = (
        res.body as { data: { id: string; role: string }[] }
      ).data.find((w) => w.id === owner.workspaceId);

      expect(shared?.role).toBe('VIEWER');
    });
  });

  // ------------------------------------------------------------------ moves

  describe('moving', () => {
    it('moves a request root → folder → back', async () => {
      const user = await signUp();
      const collection = await as(user)
        .post('/api/v1/collections', {
          workspaceId: user.workspaceId,
          name: 'C',
        })
        .expect(201);
      const collectionId = (collection.body as { id: string }).id;

      const folder = await as(user)
        .post('/api/v1/folders', { collectionId, name: 'F' })
        .expect(201);
      const folderId = (folder.body as { id: string }).id;

      const req = await as(user)
        .post('/api/v1/requests', { collectionId, name: 'r' })
        .expect(201);
      const requestId = (req.body as { id: string }).id;

      const intoFolder = await as(user)
        .patch(`/api/v1/requests/${requestId}/move`, { folderId })
        .expect(200);
      expect((intoFolder.body as { folderId: string }).folderId).toBe(folderId);

      const backToRoot = await as(user)
        .patch(`/api/v1/requests/${requestId}/move`, { folderId: null })
        .expect(200);
      expect((backToRoot.body as { folderId: null }).folderId).toBeNull();
    });

    it('lands two sequential moves in the order they were asked for', async () => {
      const user = await signUp();
      const collection = await as(user)
        .post('/api/v1/collections', {
          workspaceId: user.workspaceId,
          name: 'C',
        })
        .expect(201);
      const collectionId = (collection.body as { id: string }).id;

      const names = ['a', 'b', 'c'];
      const ids: string[] = [];
      for (const name of names) {
        const res = await as(user)
          .post('/api/v1/requests', { collectionId, name })
          .expect(201);
        ids.push((res.body as { id: string }).id);
      }

      // Move 'c' to the front, then 'a' to the front.
      await as(user)
        .patch(`/api/v1/requests/${ids[2]}/move`, { folderId: null, index: 0 })
        .expect(200);
      await as(user)
        .patch(`/api/v1/requests/${ids[0]}/move`, { folderId: null, index: 0 })
        .expect(200);

      const tree = await as(user)
        .get(`/api/v1/workspaces/${user.workspaceId}/tree`)
        .expect(200);
      expect(
        (tree.body as WorkspaceTree).collections[0].requests.map((r) => r.name),
      ).toEqual(['a', 'c', 'b']);
    });

    it('stacks root-level items in a real order rather than all at one position', async () => {
      // The `IS NOT DISTINCT FROM` trap: with `= NULL` every root-level item
      // computes against zero siblings and shares a position.
      const user = await signUp();
      const collection = await as(user)
        .post('/api/v1/collections', {
          workspaceId: user.workspaceId,
          name: 'C',
        })
        .expect(201);
      const collectionId = (collection.body as { id: string }).id;

      for (const name of ['first', 'second', 'third']) {
        await as(user)
          .post('/api/v1/requests', { collectionId, name })
          .expect(201);
      }

      const tree = await as(user)
        .get(`/api/v1/workspaces/${user.workspaceId}/tree`)
        .expect(200);
      const positions = (
        tree.body as WorkspaceTree
      ).collections[0].requests.map((r) => r.position);

      expect(new Set(positions).size).toBe(3);
      expect([...positions]).toEqual([...positions].sort((a, b) => a - b));
    });

    it('409s a folder moved inside its own descendant', async () => {
      const user = await signUp();
      const collection = await as(user)
        .post('/api/v1/collections', {
          workspaceId: user.workspaceId,
          name: 'C',
        })
        .expect(201);
      const collectionId = (collection.body as { id: string }).id;

      const outer = await as(user)
        .post('/api/v1/folders', { collectionId, name: 'outer' })
        .expect(201);
      const outerId = (outer.body as { id: string }).id;
      const inner = await as(user)
        .post('/api/v1/folders', {
          collectionId,
          parentFolderId: outerId,
          name: 'inner',
        })
        .expect(201);
      const innerId = (inner.body as { id: string }).id;

      const res = await as(user)
        .patch(`/api/v1/folders/${outerId}/move`, { parentFolderId: innerId })
        .expect(409);

      expect(errorBody(res).code).toBe(ApiErrorCode.CONFLICT);
      expect(errorBody(res).message).toMatch(/itself/i);
    });

    it('409s a folder moved into itself', async () => {
      const user = await signUp();
      const collection = await as(user)
        .post('/api/v1/collections', {
          workspaceId: user.workspaceId,
          name: 'C',
        })
        .expect(201);
      const folder = await as(user)
        .post('/api/v1/folders', {
          collectionId: (collection.body as { id: string }).id,
          name: 'f',
        })
        .expect(201);
      const folderId = (folder.body as { id: string }).id;

      await as(user)
        .patch(`/api/v1/folders/${folderId}/move`, { parentFolderId: folderId })
        .expect(409);
    });
  });

  // ---------------------------------------------------------------- cascade

  describe('cascade', () => {
    it('takes the whole subtree with a deleted collection', async () => {
      const user = await signUp();
      const collection = await as(user)
        .post('/api/v1/collections', {
          workspaceId: user.workspaceId,
          name: 'C',
        })
        .expect(201);
      const collectionId = (collection.body as { id: string }).id;

      const folder = await as(user)
        .post('/api/v1/folders', { collectionId, name: 'f' })
        .expect(201);
      await as(user)
        .post('/api/v1/requests', {
          collectionId,
          folderId: (folder.body as { id: string }).id,
          name: 'r',
        })
        .expect(201);

      await as(user).delete(`/api/v1/collections/${collectionId}`).expect(204);

      const requests = await countRows(
        `SELECT count(*)::int AS count FROM "requests" WHERE "collectionId" = $1`,
        [collectionId],
      );
      const folders = await countRows(
        `SELECT count(*)::int AS count FROM "folders" WHERE "collectionId" = $1`,
        [collectionId],
      );

      expect(requests).toBe(0);
      expect(folders).toBe(0);
    });

    it('takes a folder subtree with the folder', async () => {
      const user = await signUp();
      const collection = await as(user)
        .post('/api/v1/collections', {
          workspaceId: user.workspaceId,
          name: 'C',
        })
        .expect(201);
      const collectionId = (collection.body as { id: string }).id;

      const outer = await as(user)
        .post('/api/v1/folders', { collectionId, name: 'outer' })
        .expect(201);
      const outerId = (outer.body as { id: string }).id;
      const inner = await as(user)
        .post('/api/v1/folders', {
          collectionId,
          parentFolderId: outerId,
          name: 'inner',
        })
        .expect(201);
      const innerId = (inner.body as { id: string }).id;
      await as(user)
        .post('/api/v1/requests', {
          collectionId,
          folderId: innerId,
          name: 'deep',
        })
        .expect(201);

      await as(user).delete(`/api/v1/folders/${outerId}`).expect(204);

      const remaining = await countRows(
        `SELECT count(*)::int AS count FROM "folders" WHERE "id" = $1`,
        [innerId],
      );
      expect(remaining).toBe(0);
    });
  });

  // ------------------------------------------------------------- workspaces

  describe('workspace lifecycle', () => {
    it('409s deleting the personal workspace', async () => {
      // Without this a user can delete their only workspace and land in an app
      // with no valid route to redirect to.
      const user = await signUp();

      const res = await as(user)
        .delete(`/api/v1/workspaces/${user.workspaceId}`)
        .expect(409);

      expect(errorBody(res).code).toBe(ApiErrorCode.CONFLICT);
      expect(errorBody(res).message).toMatch(/personal/i);
    });

    it('creates, renames and deletes a non-personal workspace', async () => {
      const user = await signUp();

      const created = await as(user)
        .post('/api/v1/workspaces', { name: 'Team' })
        .expect(201);
      const body = created.body as {
        id: string;
        isPersonal: boolean;
        role: string;
      };
      expect(body.isPersonal).toBe(false);
      expect(body.role).toBe('OWNER');

      const renamed = await as(user)
        .patch(`/api/v1/workspaces/${body.id}`, { name: 'Renamed' })
        .expect(200);
      expect((renamed.body as { name: string }).name).toBe('Renamed');

      await as(user).delete(`/api/v1/workspaces/${body.id}`).expect(204);
      await as(user).get(`/api/v1/workspaces/${body.id}`).expect(404);
    });
  });

  // ------------------------------------------------------------- validation

  describe('validation', () => {
    let user: Ident;
    let collectionId: string;

    beforeAll(async () => {
      user = await signUp();
      const collection = await as(user)
        .post('/api/v1/collections', {
          workspaceId: user.workspaceId,
          name: 'C',
        })
        .expect(201);
      collectionId = (collection.body as { id: string }).id;
    });

    it('400s an unknown HTTP method', async () => {
      await as(user)
        .post('/api/v1/requests', { collectionId, name: 'x', method: 'BREW' })
        .expect(400);
    });

    it('400s an unknown body mode, naming the body field', async () => {
      const res = await as(user)
        .post('/api/v1/requests', {
          collectionId,
          name: 'x',
          body: { mode: 'nonsense' },
        })
        .expect(400);

      expect(errorBody(res).details?.map((d) => d.field)).toContain('body');
    });

    it('400s a body whose mode is right but whose payload is not', async () => {
      await as(user)
        .post('/api/v1/requests', {
          collectionId,
          name: 'x',
          body: { mode: 'json' },
        })
        .expect(400);
    });

    it('defaults scripts to the empty pair and round-trips an edit', async () => {
      const created = await as(user)
        .post('/api/v1/requests', { collectionId, name: 'scripted' })
        .expect(201);

      // The column default, visible to the client — not undefined, and not null.
      expect(created.body).toMatchObject({
        scripts: { preRequest: '', postRequest: '' },
      });

      const scripts = {
        preRequest: "pm.environment.set('t', Date.now())",
        postRequest: 'pm.test(() => {})',
      };
      const saved = await as(user)
        .patch(`/api/v1/requests/${(created.body as { id: string }).id}`, {
          scripts,
        })
        .expect(200);

      expect(saved.body).toMatchObject({ scripts });
    });

    it('400s a scripts object with a mistyped slot rather than dropping it', async () => {
      // `forbidNonWhitelisted` cannot see inside a jsonb value, so this is the
      // constraint's job. Dropping it would report success and store nothing.
      const res = await as(user)
        .post('/api/v1/requests', {
          collectionId,
          name: 'x',
          scripts: { preReqest: 'typo', postRequest: '' },
        })
        .expect(400);

      expect(errorBody(res).details?.map((d) => d.field)).toContain('scripts');
    });

    it('400s an unknown property rather than silently dropping it', async () => {
      await as(user)
        .post('/api/v1/requests', { collectionId, name: 'x', sneaky: true })
        .expect(400);
    });

    it('400s an empty name', async () => {
      await as(user)
        .post('/api/v1/requests', { collectionId, name: '   ' })
        .expect(400);
    });

    it('preserves a header row exactly, without whitelist-stripping its keys', async () => {
      // The reason the jsonb unions use one custom constraint each rather than
      // @ValidateNested: a decorated nested class under `whitelist: true`
      // silently strips keys it does not declare.
      const res = await as(user)
        .post('/api/v1/requests', {
          collectionId,
          name: 'headers',
          headers: [{ key: 'X-A', value: '1', enabled: true }],
          body: {
            mode: 'form-urlencoded',
            entries: [{ key: 'f', value: 'v', enabled: false }],
          },
        })
        .expect(201);

      const saved = res.body as {
        headers: unknown[];
        body: { entries: unknown[] };
      };
      expect(saved.headers).toEqual([
        { key: 'X-A', value: '1', enabled: true },
      ]);
      expect(saved.body.entries).toEqual([
        { key: 'f', value: 'v', enabled: false },
      ]);
    });

    it('404s a well-formed but unknown uuid, and 400s a malformed one', async () => {
      await as(user)
        .get('/api/v1/requests/11111111-1111-4111-8111-111111111111')
        .expect(404);
      await as(user).get('/api/v1/requests/not-a-uuid').expect(400);
    });
  });

  // ----------------------------------------------------------- authenticated

  it('401s every route without a token — the global guard covers this slice too', async () => {
    await request(server).get('/api/v1/workspaces').expect(401);
    await request(server)
      .post('/api/v1/collections')
      .send({ workspaceId: 'x', name: 'y' })
      .expect(401);
    await request(server)
      .get('/api/v1/workspaces/11111111-1111-4111-8111-111111111111/tree')
      .expect(401);
  });
});
