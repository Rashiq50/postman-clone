import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { THROTTLER_OPTIONS } from '@nestjs/throttler/dist/throttler.constants';
import { Test, TestingModule } from '@nestjs/testing';
import { ApiErrorCode } from '@raven/contracts';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { configureApp } from '../src/configure-app';

/**
 * Unlike `auth.e2e-spec.ts`, these tests create *users*, so the cleanup has to
 * delete rows this suite invented rather than just the seed user's sessions.
 * Every address it registers carries the `EMAIL_PREFIX` marker and `afterAll`
 * removes them by that prefix — sessions, refresh tokens and workspaces follow
 * `ON DELETE CASCADE`. Deleting by prefix rather than by a collected list also
 * cleans up after a run that was killed halfway through.
 */

const EMAIL_PREFIX = 'e2e-register-';
const EMAIL_DOMAIN = '@example.test';
const PASSWORD = 'Password123!';

interface AuthBody {
  accessToken: string;
  expiresIn: number;
  user: { id: string; email: string; name: string; createdAt: string };
}

function authBody(res: request.Response): AuthBody {
  return res.body as AuthBody;
}

function errorBody(res: request.Response): {
  code: string;
  message: string;
  details?: { field: string; message: string }[];
} {
  return (res.body as { error: ReturnType<typeof errorBody> }).error;
}

function setCookieHeader(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? (raw as string[]) : raw ? [raw as string] : [];
}

/**
 * The cookie's name comes from `AUTH_COOKIE_NAME`, so it is read from the
 * running app's config rather than hard-coded — a suite that pins the name to
 * a literal fails on any deployment that renamed it, and reports a missing
 * cookie when the cookie is right there.
 */
function refreshCookieValue(
  setCookie: string[] | undefined,
  name: string,
): string | null {
  const header = (setCookie ?? []).find((c) => c.startsWith(`${name}=`));
  if (!header) return null;
  const value = header.split(';')[0].slice(name.length + 1);
  return value.length > 0 ? value : null;
}

describe('Registration (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let server: App;
  let cookieName: string;

  // A per-run, per-test suffix: the suite must not collide with a previous run
  // that failed before its cleanup, or with a developer's own database.
  let counter = 0;
  const runId = `${process.pid.toString(36)}${Date.now().toString(36)}`;
  const freshEmail = () =>
    `${EMAIL_PREFIX}${runId}-${counter++}${EMAIL_DOMAIN}`;

  beforeAll(async () => {
    /**
     * This suite registers ~20 accounts from one address in a few seconds —
     * exactly the shape `POST /auth/register` is now rate limited against. The
     * ceiling is raised rather than the guard skipped, so it still runs and a
     * bug in it still shows up here; `register-throttle.e2e-spec.ts` is where
     * the limit is deliberately small enough to hit.
     *
     * Overriding the provider rather than `process.env`: `ConfigModule.forRoot()`
     * reads and validates the environment while the `@Module` decorator is
     * evaluated, i.e. at *import* time, so an assignment in a test file is
     * always too late to be seen.
     */
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(THROTTLER_OPTIONS)
      // All four registered windows, not just `burst`. The routes opt out of
      // the pair that is not theirs with a per-name `@SkipThrottle`, so an
      // override that omits a window leaves the suite configuring a different
      // universe from production — and a name the decorator skips but nothing
      // registers is a silent no-op rather than an error.
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
    cookieName = app.get(ConfigService).getOrThrow<string>('AUTH_COOKIE_NAME');
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM "users" WHERE "email" LIKE $1`, [
      `${EMAIL_PREFIX}%`,
    ]);
    await app.close();
  });

  const newAgent = () => request.agent(server);

  const post = (
    agent: ReturnType<typeof newAgent>,
    body: Record<string, unknown>,
  ) => agent.post('/api/v1/auth/register').send(body);

  describe('the happy path', () => {
    it('answers 201 with an access token, its lifetime and the new user', async () => {
      const email = freshEmail();

      // 201, not login's 200: registration created the account it signed in.
      const res = await post(newAgent(), {
        email,
        name: 'E2E User',
        password: PASSWORD,
      }).expect(201);

      const body = authBody(res);
      expect(body.accessToken).toEqual(expect.any(String));
      expect(body.expiresIn).toBeGreaterThan(0);
      expect(body.user.id).toEqual(expect.any(String));
      expect(body.user.email).toBe(email);
      expect(body.user.name).toBe('E2E User');
      expect(body.user).not.toHaveProperty('passwordHash');
    });

    it('sets the same httpOnly refresh cookie login does', async () => {
      const res = await post(newAgent(), {
        email: freshEmail(),
        name: 'E2E User',
        password: PASSWORD,
      }).expect(201);

      const cookie = setCookieHeader(res).find((c) =>
        c.startsWith(`${cookieName}=`),
      );
      expect(cookie).toBeDefined();
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/api/v1/auth');
    });

    /**
     * The same guarantee `login` carries: a 30-day credential in the body
     * would be readable by any script on the page, and HttpOnly would be worth
     * nothing. The password must not come back either.
     */
    it('keeps the refresh token and the password out of the body', async () => {
      const res = await post(newAgent(), {
        email: freshEmail(),
        name: 'E2E User',
        password: PASSWORD,
      }).expect(201);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('refreshToken');
      expect(raw).not.toContain(PASSWORD);
      expect(raw).not.toContain(
        refreshCookieValue(setCookieHeader(res), cookieName) as string,
      );
    });

    it('returns a token that works on a protected route straight away', async () => {
      const agent = newAgent();
      const res = await post(agent, {
        email: freshEmail(),
        name: 'E2E User',
        password: PASSWORD,
      }).expect(201);

      await agent
        .get('/api/v1/workspaces')
        .set('Authorization', `Bearer ${authBody(res).accessToken}`)
        .expect(200);
    });

    it('leaves the cookie able to refresh, without a login in between', async () => {
      const agent = newAgent();
      const created = await post(agent, {
        email: freshEmail(),
        name: 'E2E User',
        password: PASSWORD,
      }).expect(201);

      const refreshed = await agent.post('/api/v1/auth/refresh').expect(200);

      expect(
        refreshCookieValue(setCookieHeader(refreshed), cookieName),
      ).not.toBe(refreshCookieValue(setCookieHeader(created), cookieName));
    });

    it('registers an account that can then log in with the same password', async () => {
      const email = freshEmail();
      await post(newAgent(), {
        email,
        name: 'E2E User',
        password: PASSWORD,
      }).expect(201);

      await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
    });
  });

  describe('duplicates', () => {
    it('answers 409 EMAIL_TAKEN on a second registration', async () => {
      const email = freshEmail();
      await post(newAgent(), {
        email,
        name: 'First',
        password: PASSWORD,
      }).expect(201);

      const res = await post(newAgent(), {
        email,
        name: 'Second',
        password: PASSWORD,
      }).expect(409);

      expect(errorBody(res).code).toBe(ApiErrorCode.EMAIL_TAKEN);
      expect(refreshCookieValue(setCookieHeader(res), cookieName)).toBeNull();
    });

    /**
     * Normalization is the reason this is a duplicate at all: `findByEmail` is
     * an exact match, so an unnormalized `Foo@…` would insert a second row and
     * neither account could reliably be logged into.
     */
    it('treats a case- and whitespace-variant address as the same account', async () => {
      const email = freshEmail();
      await post(newAgent(), {
        email,
        name: 'First',
        password: PASSWORD,
      }).expect(201);

      const res = await post(newAgent(), {
        email: `  ${email.toUpperCase()}  `,
        name: 'Second',
        password: PASSWORD,
      }).expect(409);

      expect(errorBody(res).code).toBe(ApiErrorCode.EMAIL_TAKEN);
    });

    it('stores the normalized address, so login with the typed form works', async () => {
      const email = freshEmail();
      const res = await post(newAgent(), {
        email: `  ${email.toUpperCase()} `,
        name: 'E2E User',
        password: PASSWORD,
      }).expect(201);

      expect(authBody(res).user.email).toBe(email);

      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: email.toUpperCase(), password: PASSWORD })
        .expect(200);
    });
  });

  describe('validation', () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ['a password below the minimum length', { password: 'Pw1' }, 'password'],
      ['a password with no digit', { password: 'passwordonly' }, 'password'],
      ['a password with no letter', { password: '12345678' }, 'password'],
      ['a malformed address', { email: 'not-an-email' }, 'email'],
      ['a blank name', { name: '   ' }, 'name'],
      ['a missing name', { name: undefined }, 'name'],
    ];

    it.each(cases)('rejects %s', async (_label, override, field) => {
      const body: Record<string, unknown> = {
        email: freshEmail(),
        name: 'E2E User',
        password: PASSWORD,
        ...override,
      };
      if (override.name === undefined && 'name' in override) delete body.name;

      const res = await post(newAgent(), body).expect(400);

      const error = errorBody(res);
      expect(error.code).toBe(ApiErrorCode.VALIDATION_FAILED);
      expect(error.details?.map((d) => d.field)).toContain(field);
      expect(refreshCookieValue(setCookieHeader(res), cookieName)).toBeNull();
    });

    /**
     * One constraint on the password means one message, so the form can show
     * the actual problem instead of a stack of overlapping complaints.
     */
    it('names the specific password problem', async () => {
      const res = await post(newAgent(), {
        email: freshEmail(),
        name: 'E2E User',
        password: 'passwordonly',
      }).expect(400);

      expect(
        errorBody(res).details?.find((d) => d.field === 'password')?.message,
      ).toContain('number');
    });

    it('never echoes the rejected password back', async () => {
      const res = await post(newAgent(), {
        email: freshEmail(),
        name: 'E2E User',
        password: 'sekrit',
      }).expect(400);

      expect(JSON.stringify(res.body)).not.toContain('sekrit');
    });

    it('trims the name rather than storing the padding', async () => {
      const res = await post(newAgent(), {
        email: freshEmail(),
        name: '  Padded Name  ',
        password: PASSWORD,
      }).expect(201);

      expect(authBody(res).user.name).toBe('Padded Name');
    });

    // `forbidNonWhitelisted` — a body cannot smuggle in a column.
    it('rejects an unknown property instead of ignoring it', async () => {
      await post(newAgent(), {
        email: freshEmail(),
        name: 'E2E User',
        password: PASSWORD,
        role: 'admin',
      }).expect(400);
    });
  });

  describe('security', () => {
    /**
     * The refresh cookie is one browser-wide slot and this response overwrites
     * it. Without the revocation the previous session would live on as a ghost
     * device — reachable by nobody, revocable by nobody.
     */
    it('revokes the session behind the cookie the browser presented', async () => {
      const agent = newAgent();
      const first = await post(agent, {
        email: freshEmail(),
        name: 'First',
        password: PASSWORD,
      }).expect(201);

      await post(agent, {
        email: freshEmail(),
        name: 'Second',
        password: PASSWORD,
      }).expect(201);

      // The guard checks the session on every request, so revocation is
      // immediate rather than waiting for the old token to expire.
      await agent
        .get('/api/v1/workspaces')
        .set('Authorization', `Bearer ${authBody(first).accessToken}`)
        .expect(401);
    });

    it('leaves the old session alone when the registration fails', async () => {
      const agent = newAgent();
      const taken = freshEmail();
      await post(newAgent(), {
        email: taken,
        name: 'Holder',
        password: PASSWORD,
      }).expect(201);

      const first = await post(agent, {
        email: freshEmail(),
        name: 'First',
        password: PASSWORD,
      }).expect(201);

      await post(agent, {
        email: taken,
        name: 'Second',
        password: PASSWORD,
      }).expect(409);

      await agent
        .get('/api/v1/workspaces')
        .set('Authorization', `Bearer ${authBody(first).accessToken}`)
        .expect(200);
    });

    it('rejects a cross-origin registration', async () => {
      await request(server)
        .post('/api/v1/auth/register')
        .set('Origin', 'http://evil.example')
        .send({ email: freshEmail(), name: 'E2E User', password: PASSWORD })
        .expect(403);
    });
  });
});
