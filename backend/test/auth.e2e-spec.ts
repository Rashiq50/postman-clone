import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';

/**
 * These are the first *mutating* e2e tests in the repo — `app.e2e-spec.ts` is
 * read-only. They run against whatever database `.env` points at, so every
 * describe block cleans up the seed user's sessions afterwards. Pointing
 * `test:e2e` at a scratch database would be better and is a known gap in the
 * README; until then, the cleanup below is what keeps a test run from leaving
 * the developer's own login revoked.
 */

const EMAIL = 'rashiqrahaman@yahoo.com';
const PASSWORD = 'Password123!';
const COOKIE_NAME = 'pc_refresh_token';

interface AuthBody {
  accessToken: string;
  expiresIn: number;
  user: { id: string; email: string; name: string; createdAt: string };
}

/** Pulls the refresh cookie's value out of a `set-cookie` header list. */
function refreshCookieValue(setCookie: string[] | undefined): string | null {
  const header = (setCookie ?? []).find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!header) return null;
  const value = header.split(';')[0].slice(COOKIE_NAME.length + 1);
  return value.length > 0 ? value : null;
}

function setCookieHeader(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? (raw as string[]) : raw ? [raw as string] : [];
}

/**
 * supertest types `res.body` as `any`. These narrow it once, here, so the
 * assertions below stay readable and type-checked.
 */
function authBody(res: request.Response): AuthBody {
  return res.body as AuthBody;
}

function errorMessage(res: request.Response): string {
  return (res.body as { error: { message: string } }).error.message;
}

interface SessionRow {
  id: string;
  current: boolean;
}

function sessionPage(res: request.Response): {
  data: SessionRow[];
  meta: { total: number };
} {
  return res.body as { data: SessionRow[]; meta: { total: number } };
}

describe('Auth and sessions (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let server: App;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    dataSource = app.get(DataSource);
  });

  /** Every test starts from a clean slate for the seed user. */
  beforeEach(async () => {
    await dataSource.query(
      `DELETE FROM "sessions" WHERE "userId" IN (SELECT "id" FROM "users" WHERE "email" = $1)`,
      [EMAIL],
    );
  });

  // One hook, in this order: the cleanup query needs a live DataSource, and
  // `app.close()` tears it down.
  afterAll(async () => {
    await dataSource.query(
      `DELETE FROM "sessions" WHERE "userId" IN (SELECT "id" FROM "users" WHERE "email" = $1)`,
      [EMAIL],
    );
    await app.close();
  });

  /** supertest's agent carries a cookie jar, i.e. it behaves like one browser. */
  const newAgent = () => request.agent(server);

  async function login(agent: ReturnType<typeof newAgent>) {
    const res = await agent
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
    return res;
  }

  describe('login', () => {
    it('sets an httpOnly refresh cookie scoped to the auth routes', async () => {
      const res = await login(newAgent());

      const cookie = setCookieHeader(res).find((c) =>
        c.startsWith(`${COOKIE_NAME}=`),
      );
      expect(cookie).toBeDefined();
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/api/v1/auth');
    });

    /**
     * The refresh token must never appear in the body. If it did, any script on
     * the page could read a 30-day credential straight out of the login
     * response and the cookie's HttpOnly flag would be worth nothing.
     */
    it('never puts the refresh token in the response body', async () => {
      const res = await login(newAgent());

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('refreshToken');

      const cookieValue = refreshCookieValue(setCookieHeader(res));
      expect(cookieValue).toBeTruthy();
      expect(raw).not.toContain(cookieValue as string);
    });

    it('returns the access token, its lifetime and the user', async () => {
      const res = await login(newAgent());
      const body = authBody(res);

      expect(body.accessToken).toEqual(expect.any(String));
      expect(body.expiresIn).toBeGreaterThan(0);
      expect(body.user.email).toBe(EMAIL);
      expect(body.user).not.toHaveProperty('passwordHash');
    });

    it('rejects a wrong password without setting a cookie', async () => {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: EMAIL, password: 'wrong' })
        .expect(401);

      expect(refreshCookieValue(setCookieHeader(res))).toBeNull();
    });
  });

  describe('the full cycle', () => {
    it('logs in, calls a protected route, and refreshes twice', async () => {
      const agent = newAgent();
      const first = await login(agent);
      const firstCookie = refreshCookieValue(setCookieHeader(first));

      await agent
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${authBody(first).accessToken}`)
        .expect(200);

      const second = await agent.post('/api/v1/auth/refresh').expect(200);
      const secondCookie = refreshCookieValue(setCookieHeader(second));

      // Rotation: a refresh always hands back a different token.
      expect(secondCookie).toBeTruthy();
      expect(secondCookie).not.toBe(firstCookie);

      await agent.post('/api/v1/auth/refresh').expect(200);
    });

    /**
     * The payoff of the session/refresh-token split: rotating the token does
     * not disturb `sid`, so an access token issued before the refresh keeps
     * working. If rotation replaced the session row, this would 401.
     */
    it('keeps an already-issued access token valid across a rotation', async () => {
      const agent = newAgent();
      const { accessToken } = authBody(await login(agent));

      await agent.post('/api/v1/auth/refresh').expect(200);

      await agent
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
    });
  });

  describe('reuse detection', () => {
    /**
     * The highest-severity trap in this feature. On reuse the service must
     * revoke the family *and* reject the request, and it must not do the second
     * with a `throw` from inside the transaction — that would roll the
     * revocation back, leaving a detector that still 401s the caller and so
     * still looks correct, while never actually revoking anything.
     *
     * The third assertion is what catches it: the *current* cookie and a
     * previously-valid access token must both be dead too. Only a committed
     * family revocation produces that.
     */
    it('revokes the whole family when a spent token is replayed', async () => {
      const agent = newAgent();
      const first = await login(agent);
      const firstCookie = refreshCookieValue(setCookieHeader(first));
      const accessToken = authBody(first).accessToken;

      // Rotate once, so `firstCookie` is now spent.
      const second = await agent.post('/api/v1/auth/refresh').expect(200);
      const secondCookie = refreshCookieValue(setCookieHeader(second));

      // Replay the spent token past the grace window by ageing `usedAt`.
      await dataSource.query(
        `UPDATE "refresh_tokens" SET "usedAt" = now() - interval '1 hour' WHERE "usedAt" IS NOT NULL`,
      );

      await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${COOKIE_NAME}=${firstCookie}`)
        .expect(401);

      // The current, never-spent token is dead too — the family went with it.
      await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${COOKIE_NAME}=${secondCookie}`)
        .expect(401);

      // And so is the access token, which proves the guard sees the revocation.
      const denied = await request(server)
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);
      expect(errorMessage(denied)).toBe('Session is no longer active');
    });

    /** Two tabs racing is not theft: a fast replay is accepted. */
    it('accepts a replay inside the grace window', async () => {
      const agent = newAgent();
      const first = await login(agent);
      const firstCookie = refreshCookieValue(setCookieHeader(first));

      await agent.post('/api/v1/auth/refresh').expect(200);

      // Immediately, i.e. well inside REFRESH_ROTATION_GRACE_MS.
      await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${COOKIE_NAME}=${firstCookie}`)
        .expect(200);
    });

    /**
     * Catches a sliding-window implementation. The grace window is measured
     * from the token's *first* use, so the accepted replay above must not have
     * re-stamped `usedAt`: if it had, an attacker replaying a stolen token
     * every `grace − ε` would read as benign forever and reuse detection would
     * never fire at all.
     */
    it('still rejects the same token once the window has passed since its first use', async () => {
      const agent = newAgent();
      const first = await login(agent);
      const firstCookie = refreshCookieValue(setCookieHeader(first));

      await agent.post('/api/v1/auth/refresh').expect(200);

      // An accepted, in-grace replay. A sliding window would re-stamp here.
      await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${COOKIE_NAME}=${firstCookie}`)
        .expect(200);

      // Age only the *first* use. Under a correct implementation the token's
      // `usedAt` is still its original stamp, so this puts it past the window.
      await dataSource.query(
        `UPDATE "refresh_tokens" SET "usedAt" = now() - interval '1 hour' WHERE "usedAt" IS NOT NULL`,
      );

      await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${COOKIE_NAME}=${firstCookie}`)
        .expect(401);
    });

    it('revokes nothing when an unknown token is presented', async () => {
      const agent = newAgent();
      await login(agent);

      await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${COOKIE_NAME}=not-a-real-token`)
        .expect(401);

      // A random guess must not be able to log anybody out.
      await agent.post('/api/v1/auth/refresh').expect(200);
    });
  });

  describe('logout', () => {
    it('expires the cookie and kills the still-unexpired access token', async () => {
      const agent = newAgent();
      const { accessToken } = authBody(await login(agent));

      const res = await agent.post('/api/v1/auth/logout').expect(204);

      const cleared = setCookieHeader(res).find((c) =>
        c.startsWith(`${COOKIE_NAME}=`),
      );
      expect(cleared).toBeDefined();
      // An asymmetric clear is the single most common bug in this feature: if
      // the options do not match the ones used to set it, the browser keeps
      // the cookie and logout silently does nothing.
      expect(cleared).toContain('Path=/api/v1/auth');
      expect(refreshCookieValue(setCookieHeader(res))).toBeNull();

      await request(server)
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);
    });

    // A protected logout would 401 exactly when a user most wants it to work.
    it('is 204 even with no cookie at all', async () => {
      await request(server).post('/api/v1/auth/logout').expect(204);
    });
  });

  describe('logout-all', () => {
    it('ends every session the user has, on every device', async () => {
      const agentA = newAgent();
      const agentB = newAgent();
      const a = await login(agentA);
      const b = await login(agentB);

      await agentA
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${authBody(a).accessToken}`)
        .expect(204);

      await request(server)
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${authBody(b).accessToken}`)
        .expect(401);
      await agentB.post('/api/v1/auth/refresh').expect(401);
    });

    it('requires a live access token, unlike logout', async () => {
      await request(server).post('/api/v1/auth/logout-all').expect(401);
    });
  });

  describe('GET /auth/me', () => {
    it('returns the caller without the password hash', async () => {
      const agent = newAgent();
      const { accessToken } = authBody(await login(agent));

      const res = await agent
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const me = res.body as { email: string };
      expect(me.email).toBe(EMAIL);
      expect(me).not.toHaveProperty('passwordHash');
    });
  });

  describe('GET /sessions', () => {
    it('lists both devices with exactly one marked current, and revokes one', async () => {
      // Two *separate* agents, i.e. two browsers with their own cookie jars. A
      // second login from the same agent would present the first login's cookie
      // and AuthService.login would revoke that session, leaving the total at 1.
      const agentA = newAgent();
      const agentB = newAgent();
      const a = await login(agentA);
      await login(agentB);

      const tokenA = authBody(a).accessToken;

      const list = await agentA
        .get('/api/v1/sessions')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(sessionPage(list).meta.total).toBe(2);
      expect(sessionPage(list).data.filter((s) => s.current)).toHaveLength(1);

      const other = sessionPage(list).data.find((s) => !s.current)!.id;

      await agentA
        .delete(`/api/v1/sessions/${other}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(204);

      const after = await agentA
        .get('/api/v1/sessions')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(sessionPage(after).meta.total).toBe(1);
    });

    // 404 rather than 403, so session ids cannot be enumerated.
    it('is 404 for a session that is not the caller’s', async () => {
      const agent = newAgent();
      const { accessToken } = authBody(await login(agent));

      await agent
        .delete('/api/v1/sessions/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });

    it('is 400 for a non-UUID id', async () => {
      const agent = newAgent();
      const { accessToken } = authBody(await login(agent));

      await agent
        .delete('/api/v1/sessions/not-a-uuid')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);
    });

    /**
     * The same-browser orphan fix. Because the refresh cookie is one shared
     * slot, a second login in the same browser overwrites it — and without
     * revoking the old session first, that session would sit live for its full
     * lifetime as a ghost device the user cannot recognise, one per re-login.
     */
    it('leaves one row when the same browser logs in twice', async () => {
      const agent = newAgent();
      await login(agent);
      const second = await login(agent);

      const list = await agent
        .get('/api/v1/sessions')
        .set('Authorization', `Bearer ${authBody(second).accessToken}`)
        .expect(200);

      expect(sessionPage(list).meta.total).toBe(1);
    });
  });

  /**
   * The CSRF backstop on the public, state-changing auth routes. Their only
   * credential is a cookie the browser attaches automatically, which is the
   * textbook CSRF shape. `SameSite=Lax` already closes it; this guard means
   * that protection does not silently depend on `COOKIE_SAME_SITE` never being
   * set to `none` for some future cross-site deployment.
   */
  describe('origin check', () => {
    const FOREIGN = 'http://evil.example';

    it('rejects a foreign Origin on refresh', async () => {
      const agent = newAgent();
      await login(agent);

      await agent
        .post('/api/v1/auth/refresh')
        .set('Origin', FOREIGN)
        .expect(403);
    });

    it('rejects a foreign Origin on login and logout', async () => {
      await request(server)
        .post('/api/v1/auth/login')
        .set('Origin', FOREIGN)
        .send({ email: EMAIL, password: PASSWORD })
        .expect(403);

      await request(server)
        .post('/api/v1/auth/logout')
        .set('Origin', FOREIGN)
        .expect(403);
    });

    it('allows the configured origin', async () => {
      const agent = newAgent();
      await login(agent);

      await agent
        .post('/api/v1/auth/refresh')
        .set('Origin', 'http://localhost:5173')
        .expect(200);
    });

    // Non-browser clients (curl, this suite, mobile apps) legitimately send no
    // Origin, and CSRF is a browser-only attack.
    it('allows a request with no Origin at all', async () => {
      const agent = newAgent();
      await login(agent);

      await agent.post('/api/v1/auth/refresh').expect(200);
    });
  });
});
