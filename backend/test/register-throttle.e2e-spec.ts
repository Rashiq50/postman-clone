import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
// Not re-exported from the package index, hence the deep path. If an upgrade
// moves it, both this suite and `register.e2e-spec.ts` fail loudly rather than
// silently running against the real limits — the overrides are load-bearing in
// opposite directions, so neither can pass with the token unresolved.
import { THROTTLER_OPTIONS } from '@nestjs/throttler/dist/throttler.constants';
import { ApiErrorCode } from '@postman-clone/contracts';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { configureApp } from '../src/configure-app';

/**
 * Rate limiting on `POST /auth/register`.
 *
 * Only the *numbers* are overridden — `ApiThrottlerGuard`, its route binding
 * and its storage are the real ones, so this exercises the control rather than
 * a stand-in. The window has to be shrunk somehow: the shipped default is 5
 * per minute, and a suite cannot wait out an hour-long sustained window.
 *
 * `THROTTLER_OPTIONS` is overridden rather than `process.env` because
 * `ConfigModule.forRoot()` reads and validates the environment while the
 * `@Module` decorator is evaluated — at *import* time — so an assignment in a
 * test file is always too late. `buildThrottlerOptions` covers the
 * env-to-options wiring separately, as a pure function.
 *
 * The counter is in-memory and per process, which is what makes this testable
 * at all — and is the limitation worth remembering in production, where two
 * instances allow twice the configured rate.
 */
const BURST_LIMIT = 3;
const BURST_TTL_MS = 60000;

const EMAIL_PREFIX = 'e2e-throttle-';
const PASSWORD = 'Password123!';

function errorBody(res: request.Response): { code: string; message: string } {
  return (res.body as { error: { code: string; message: string } }).error;
}

describe('Registration rate limiting (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let server: App;

  let counter = 0;
  const runId = `${process.pid.toString(36)}${Date.now().toString(36)}`;
  const freshEmail = () => `${EMAIL_PREFIX}${runId}-${counter++}@example.test`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(THROTTLER_OPTIONS)
      .useValue({
        throttlers: [{ name: 'burst', ttl: BURST_TTL_MS, limit: BURST_LIMIT }],
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

  const register = (body: Record<string, unknown>) =>
    request(server).post('/api/v1/auth/register').send(body);

  const validBody = () => ({
    email: freshEmail(),
    name: 'Throttle Test',
    password: PASSWORD,
  });

  /**
   * One `describe` with a shared budget: the throttler's window is per process
   * and per address, so every test in this file draws on the same bucket. The
   * order below spends it deliberately — anything added must account for that
   * rather than assume a clean slate.
   */
  it('allows registrations up to the limit, then refuses', async () => {
    for (let i = 0; i < BURST_LIMIT; i++) {
      await register(validBody()).expect(201);
    }

    const res = await register(validBody()).expect(429);

    expect(errorBody(res).code).toBe(ApiErrorCode.RATE_LIMITED);
    expect(errorBody(res).message).toMatch(/try again in \d+ seconds?\./i);
  });

  /**
   * Without this the limit is advice, not a control: an attacker enumerating
   * addresses only ever sends bodies that fail, and a throttler that counted
   * successes alone would never see them.
   */
  it('has already refused, so a rejected body costs budget too', async () => {
    const res = await register({ ...validBody(), password: 'short' }).expect(
      429,
    );

    expect(errorBody(res).code).toBe(ApiErrorCode.RATE_LIMITED);
  });

  it('tells the client how long to wait in a header as well', async () => {
    const res = await register(validBody()).expect(429);

    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(BURST_TTL_MS / 1000);
  });

  // The refusal happens before the handler, so no account is created and no
  // session cookie is issued.
  it('creates nothing once it is refusing', async () => {
    const email = freshEmail();
    await register({ email, name: 'Blocked', password: PASSWORD }).expect(429);

    const rows: unknown[] = await dataSource.query(
      `SELECT 1 FROM "users" WHERE "email" = $1`,
      [email],
    );
    expect(rows).toHaveLength(0);
  });

  /**
   * The guard is per-route, not an `APP_GUARD`. If it ever became global, a
   * burst of registrations would start locking users out of signing in — and
   * behind a proxy, out of everything.
   */
  it('does not spend login’s budget along with register’s', async () => {
    await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.test', password: 'wrong-password' })
      .expect(401);
  });
});
