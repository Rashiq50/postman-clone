/**
 * The session cap, which needs a lower `MAX_SESSIONS_PER_USER` than `.env`
 * carries.
 *
 * It lives in its own file because `ConfigModule.forRoot()` runs when
 * `app.module.ts` is first imported and validates the environment exactly once
 * per process — so changing `process.env` inside a test would come too late.
 * Setting it here, before `AppModule` is imported (via `require` in `beforeAll`,
 * since static imports are hoisted above this line), is what makes it take
 * effect. @nestjs/config only applies a `.env` key when it is not already in
 * `process.env`, so this wins.
 */
process.env.MAX_SESSIONS_PER_USER = '3';

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { configureApp } from '../src/configure-app';

const EMAIL = 'rashiqrahaman@yahoo.com';
const PASSWORD = 'Password123!';

interface AuthBody {
  accessToken: string;
}

describe('Session cap (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let server: App;

  beforeAll(async () => {
    // `require`, not `await import()`: ts-jest emits the latter as a native
    // dynamic import, which the CommonJS test environment refuses. It also has
    // to run *here* rather than at the top of the file, so that it happens
    // after the `process.env` assignment above. The cast keeps it fully typed.
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { AppModule } =
      require('../src/app.module') as typeof import('../src/app.module');
    /* eslint-enable @typescript-eslint/no-require-imports */

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    dataSource = app.get(DataSource);
  });

  const clean = () =>
    dataSource.query(
      `DELETE FROM "sessions" WHERE "userId" IN (SELECT "id" FROM "users" WHERE "email" = $1)`,
      [EMAIL],
    );

  beforeEach(clean);

  afterAll(async () => {
    await clean();
    await app.close();
  });

  /**
   * Each login from a *fresh* agent, i.e. a separate browser. A second login
   * from the same agent would present the previous login's cookie, and
   * `AuthService.login`'s same-browser revocation — not the cap — is what would
   * trim the list.
   */
  async function loginFromNewBrowser(): Promise<string> {
    const res = await request
      .agent(server)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
    return (res.body as AuthBody).accessToken;
  }

  async function liveSessionCount(accessToken: string): Promise<number> {
    const res = await request(server)
      .get('/api/v1/sessions')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    return (res.body as { meta: { total: number } }).meta.total;
  }

  it('holds the user at the cap and keeps holding it', async () => {
    const first = await loginFromNewBrowser();
    await loginFromNewBrowser();
    await loginFromNewBrowser();
    const fourth = await loginFromNewBrowser();

    expect(await liveSessionCount(fourth)).toBe(3);

    // The evicted device stops working silently: its next request 401s and it
    // lands on /login with the same generic message as any other dead session.
    // At a cap of 10 a real user effectively never sees this; credential
    // stuffing does.
    const denied = await request(server)
      .get('/api/v1/tasks')
      .set('Authorization', `Bearer ${first}`)
      .expect(401);
    expect((denied.body as { error: { message: string } }).error.message).toBe(
      'Session is no longer active',
    );

    const fifth = await loginFromNewBrowser();
    expect(await liveSessionCount(fifth)).toBe(3);
  });

  /**
   * Revoked, not deleted — the row stays queryable for audit and is collected
   * later by `deleteExpiredSessions` once `expiresAt` passes. The list endpoint
   * filters revoked sessions out, so this assertion has to go past the API.
   */
  it('revokes the evicted session rather than deleting it', async () => {
    await loginFromNewBrowser();
    await loginFromNewBrowser();
    await loginFromNewBrowser();
    await loginFromNewBrowser();

    const rows: Array<{ revokedAt: Date | null }> = await dataSource.query(
      `SELECT "revokedAt" FROM "sessions" WHERE "userId" IN (SELECT "id" FROM "users" WHERE "email" = $1)`,
      [EMAIL],
    );

    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.revokedAt !== null)).toHaveLength(1);
  });

  /**
   * `COALESCE("lastUsedAt", "createdAt")` is load-bearing, and this is the case
   * that proves it. `lastUsedAt` is null until a session's first rotation and
   * Postgres sorts nulls *first* under `DESC`, so a bare
   * `ORDER BY "lastUsedAt" DESC` would rank every never-refreshed session as
   * the most recently active — and preferentially evict the sessions actually
   * in use. A bare ordering passes every other test in this file.
   */
  it('keeps an old session that was used recently over a newer, unused one', async () => {
    const oldButActive = await loginFromNewBrowser();
    await loginFromNewBrowser();
    await loginFromNewBrowser();

    // Age the first session's creation well past the others', but mark it as
    // having been used a moment ago.
    await dataSource.query(
      `UPDATE "sessions" SET "createdAt" = now() - interval '10 days', "lastUsedAt" = now()
       WHERE "id" = (
         SELECT "id" FROM "sessions"
         WHERE "userId" IN (SELECT "id" FROM "users" WHERE "email" = $1)
         ORDER BY "createdAt" ASC LIMIT 1
       )`,
      [EMAIL],
    );

    // A fourth login pushes the user over the cap.
    await loginFromNewBrowser();

    // The oldest-created session survives, because it is the most recently
    // *active*. Under a bare `ORDER BY "lastUsedAt"` it would have been evicted.
    await request(server)
      .get('/api/v1/tasks')
      .set('Authorization', `Bearer ${oldButActive}`)
      .expect(200);
  });
});
