import { INestApplication } from '@nestjs/common';
import { THROTTLER_OPTIONS } from '@nestjs/throttler/dist/throttler.constants';
import { Test, TestingModule } from '@nestjs/testing';
import { ApiErrorCode, type SendResult } from '@raven/contracts';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { SEND_OPTIONS, type SendOptions } from '../src/execution/send-options';

/**
 * Sending, end to end, against a local `http.createServer` fixture so nothing
 * in this suite touches the public internet.
 *
 * ⚠️ **The `SEND_OPTIONS` provider is overridden, never `process.env`.**
 * `ConfigModule.forRoot()` reads and validates the environment while the
 * `@Module` decorator is evaluated — at *import* time — so an assignment at the
 * top of this file would always be too late. That is the identical trap already
 * recorded for `THROTTLER_OPTIONS`, and it is not theoretical here: the fixture
 * listens on `127.0.0.1`, which the real policy blocks outright.
 *
 * ⚠️ **The screening predicate is part of the options, and that is what makes
 * this suite expressible at all.** A bare `allowPrivateNetwork: boolean` could
 * not cover it: the happy-path tests need `127.0.0.1` *allowed*, the
 * blocked-address test needs an address *blocked*, and the redirect test needs
 * hop 1 allowed while hop 2 is blocked — and locally every one of those is
 * loopback. One override serves all three: allow `127.0.0.1`, block the marker
 * `127.0.0.2` (still loopback, nothing bound to it). Production never
 * overrides it.
 *
 * Cleanup follows `workspaces.e2e-spec.ts`: users are deleted by the email
 * prefix, and everything else — workspaces, collections, requests and their
 * executions — follows by `ON DELETE CASCADE`.
 */

const EMAIL_PREFIX = 'e2e-send-';
const EMAIL_DOMAIN = '@example.test';
const PASSWORD = 'Password123!';
const ORIGIN = 'http://localhost:5173';

/** Blocked by the test predicate, so it stands in for "the public internet". */
const BLOCKED_HOST = 'http://127.0.0.2/';

const HISTORY_CAP = 3;

interface Ident {
  token: string;
  userId: string;
  workspaceId: string;
}

function errorBody(res: request.Response): { code: string; message: string } {
  return (res.body as { error: { code: string; message: string } }).error;
}

describe('Sending a request (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let server: App;

  /** The upstream the sends actually reach. */
  let fixture: http.Server;
  let fixtureOrigin: string;
  let handler: http.RequestListener;
  let connections: number;

  let counter = 0;
  const runId = `${process.pid.toString(36)}${Date.now().toString(36)}`;
  const freshEmail = () => `${EMAIL_PREFIX}${runId}-${counter++}${EMAIL_DOMAIN}`;

  beforeAll(async () => {
    fixture = http.createServer((req, res) => handler(req, res));
    fixture.on('connection', () => {
      connections += 1;
    });
    await new Promise<void>((resolve) =>
      fixture.listen(0, '127.0.0.1', resolve),
    );
    fixtureOrigin = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}`;

    const sendOptions: SendOptions = {
      allowPrivateNetwork: false,
      connectTimeoutMs: 2000,
      totalTimeoutMs: 5000,
      maxRedirects: 5,
      maxResponseBytes: 2048,
      maxRequestBodyBytes: 1024 * 1024,
      maxStoredBodyBytes: 1024,
      historyPerRequest: HISTORY_CAP,
      historyRetentionDays: 30,
      // The whole point of the injectable predicate — see the file comment.
      isBlockedAddress: (ip) => ip === '127.0.0.2',
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(THROTTLER_OPTIONS)
      .useValue({
        throttlers: [
          { name: 'burst', ttl: 60000, limit: 500 },
          { name: 'sustained', ttl: 3600000, limit: 500 },
          { name: 'sendBurst', ttl: 60000, limit: 500 },
          { name: 'sendSustained', ttl: 3600000, limit: 500 },
        ],
      })
      .overrideProvider(SEND_OPTIONS)
      .useValue(sendOptions)
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
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  });

  beforeEach(() => {
    connections = 0;
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    };
  });

  async function signUp(): Promise<Ident> {
    const res = await request(server)
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .send({ email: freshEmail(), name: 'E2E Send User', password: PASSWORD })
      .expect(201);

    const token = (res.body as { accessToken: string }).accessToken;
    const userId = (res.body as { user: { id: string } }).user.id;

    const workspaces = await request(server)
      .get('/api/v1/workspaces')
      .auth(token, { type: 'bearer' })
      .expect(200);

    const workspaceId = (workspaces.body as { data: { id: string }[] }).data[0]
      .id;

    return { token, userId, workspaceId };
  }

  const as = (ident: Ident) => ({
    get: (url: string) =>
      request(server).get(url).auth(ident.token, { type: 'bearer' }),
    post: (url: string, body: unknown) =>
      request(server)
        .post(url)
        .auth(ident.token, { type: 'bearer' })
        .send(body as object),
    put: (url: string, body: unknown) =>
      request(server)
        .put(url)
        .auth(ident.token, { type: 'bearer' })
        .send(body as object),
    delete: (url: string) =>
      request(server).delete(url).auth(ident.token, { type: 'bearer' }),
  });

  /** A collection + request, ready to send. */
  async function makeRequest(
    ident: Ident,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const collection = await as(ident)
      .post('/api/v1/collections', {
        workspaceId: ident.workspaceId,
        name: 'Send collection',
      })
      .expect(201);

    const collectionId = (collection.body as { id: string }).id;

    const created = await as(ident)
      .post('/api/v1/requests', {
        collectionId,
        name: 'Send request',
        method: 'GET',
        url: `${fixtureOrigin}/`,
        ...overrides,
      })
      .expect(201);

    return (created.body as { id: string }).id;
  }

  const send = (ident: Ident, requestId: string, body: unknown = {}) =>
    as(ident).post(`/api/v1/requests/${requestId}/send`, body);

  const resultOf = (res: request.Response): SendResult => res.body as SendResult;

  let user: Ident;
  beforeAll(async () => {
    // A single account for the whole suite; each test makes its own request row.
    user = await signUp();
  });

  // ------------------------------------------------------------- the contract

  describe('an upstream failure is not an API error of ours', () => {
    it('returns 200 with the body and headers on a plain success', async () => {
      const id = await makeRequest(user);
      const result = resultOf(await send(user, id).expect(200));

      expect(result.result).toMatchObject({
        outcome: 'response',
        status: 200,
        body: { encoding: 'text', text: '{"ok":true}' },
      });
      expect(
        result.result.outcome === 'response' &&
          result.result.headers.some((h) => h.name === 'content-type'),
      ).toBe(true);
      expect(result.executionId).not.toBeNull();
      expect(result.usedDraft).toBe(false);
    });

    // ⚠️ The single most important assertion in the suite. A 500 from the
    // target arriving as a 500 from us would be indistinguishable from our own
    // backend falling over.
    it('returns HTTP 200 when the target returns 500', async () => {
      handler = (_req, res) => {
        res.writeHead(500);
        res.end('upstream boom');
      };

      const id = await makeRequest(user);
      const result = resultOf(await send(user, id).expect(200));

      expect(result.result).toMatchObject({
        outcome: 'response',
        status: 500,
        body: { encoding: 'text', text: 'upstream boom' },
      });
    });

    it('returns HTTP 200 with kind "connect" when the connection is refused', async () => {
      const id = await makeRequest(user, { url: 'http://127.0.0.1:1/' });
      const result = resultOf(await send(user, id).expect(200));

      expect(result.result).toMatchObject({
        outcome: 'failure',
        kind: 'connect',
      });
    });
  });

  // ------------------------------------------------------------------- SSRF

  describe('the address policy', () => {
    it('blocks a screened address, and opens no socket at all', async () => {
      const id = await makeRequest(user, { url: BLOCKED_HOST });
      const result = resultOf(await send(user, id).expect(200));

      expect(result.result).toMatchObject({
        outcome: 'failure',
        kind: 'blocked-address',
      });
      // Screening happens before a socket is created, not after a connection
      // is inspected — so the fixture must have seen nothing.
      expect(connections).toBe(0);
    });

    // ⚠️ Every hop re-screens: the first hop's clearance says nothing about the
    // second's, and reusing it is the same TOCTOU hole in a different coat.
    it('blocks a redirect hop to a blocked address', async () => {
      handler = (_req, res) => {
        res.writeHead(302, { location: BLOCKED_HOST });
        res.end();
      };

      const id = await makeRequest(user);
      const result = resultOf(await send(user, id).expect(200));

      expect(result.result).toMatchObject({
        outcome: 'failure',
        kind: 'blocked-address',
      });
      expect(result.redirects).toHaveLength(1);
      expect(result.redirects[0].to).toBe(BLOCKED_HOST);
    });

    // ⚠️ Forwarding a bearer token to whatever host a redirect names is a
    // credential-exfiltration primitive.
    it('does not forward Authorization across a cross-origin redirect', async () => {
      const other = http.createServer();
      await new Promise<void>((resolve) =>
        other.listen(0, '127.0.0.1', resolve),
      );
      const otherPort = (other.address() as AddressInfo).port;

      let forwarded: string | undefined = 'never-called';
      other.on('request', (req, res) => {
        forwarded = req.headers.authorization;
        res.end('elsewhere');
      });

      handler = (_req, res) => {
        res.writeHead(302, { location: `http://127.0.0.1:${otherPort}/` });
        res.end();
      };

      const id = await makeRequest(user, {
        auth: { type: 'bearer', token: 'super-secret' },
      });
      const result = resultOf(await send(user, id).expect(200));

      expect(forwarded).toBeUndefined();
      expect(result.warnings.map((w) => w.kind)).toContain(
        'auth-stripped-on-cross-origin-redirect',
      );

      await new Promise<void>((resolve) => other.close(() => resolve()));
    });
  });

  // ------------------------------------------------------------ the payload

  describe('bodies, headers and caps', () => {
    // **Overflow is a success, not a failure** — the status line already
    // arrived and is the useful part.
    it('truncates an over-cap response but still reports the status', async () => {
      handler = (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('x'.repeat(10_000));
      };

      const id = await makeRequest(user);
      const result = resultOf(await send(user, id).expect(200));

      expect(result.result).toMatchObject({
        outcome: 'response',
        status: 200,
        bodyTruncated: true,
      });
      expect(result.warnings.map((w) => w.kind)).toContain('body-truncated');
    });

    // ⚠️ `\0` is valid UTF-8 and the fatal decoder passes it, but Postgres
    // rejects it in a text/jsonb column — so a body that decodes to text
    // containing NUL must still fall to base64, or the history insert 500s and
    // the user is told a successful send failed.
    it('stores and returns a NUL-containing body as base64, and history survives', async () => {
      handler = (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(Buffer.from([0x61, 0x00, 0x62]));
      };

      const id = await makeRequest(user);
      const result = resultOf(await send(user, id).expect(200));

      expect(result.result).toMatchObject({
        outcome: 'response',
        body: {
          encoding: 'base64',
          base64: Buffer.from([0x61, 0x00, 0x62]).toString('base64'),
        },
      });
      // The insert succeeded, which is the half of this that a decode check
      // alone would not have caught.
      expect(result.executionId).not.toBeNull();

      const stored = await as(user)
        .get(`/api/v1/executions/${result.executionId!}`)
        .expect(200);
      expect((stored.body as { body: { encoding: string } }).body.encoding).toBe(
        'base64',
      );
    });

    // ⚠️ This is why header validation exists at all: a saved request is
    // authored by a human, but a variable can carry CRLF.
    it('refuses a header whose value came from a variable carrying CRLF', async () => {
      const environmentId = await createEnvironment(user, [
        { key: 'evil', value: 'x\r\nX-Admin: 1', enabled: true },
      ]);

      const id = await makeRequest(user, {
        headers: [{ key: 'X-Token', value: '{{evil}}', enabled: true }],
      });

      const result = resultOf(
        await send(user, id, { environmentId }).expect(200),
      );

      expect(result.result).toMatchObject({
        outcome: 'failure',
        kind: 'invalid-header',
      });
      expect(connections).toBe(0);
    });

    it('sends the draft rather than the saved row, and records usedDraft', async () => {
      let seenPath = '';
      handler = (req, res) => {
        seenPath = req.url ?? '';
        res.end('ok');
      };

      const id = await makeRequest(user);
      const result = resultOf(
        await send(user, id, {
          draft: { url: `${fixtureOrigin}/from-the-draft` },
        }).expect(200),
      );

      expect(seenPath).toBe('/from-the-draft');
      expect(result.usedDraft).toBe(true);

      const stored = await as(user)
        .get(`/api/v1/executions/${result.executionId!}`)
        .expect(200);
      expect((stored.body as { usedDraft: boolean }).usedDraft).toBe(true);
    });
  });

  // ---------------------------------------------------------- interpolation

  async function createEnvironment(
    ident: Ident,
    variables: { key: string; value: string; enabled: boolean; secret?: boolean }[],
  ): Promise<string> {
    const res = await as(ident)
      .post('/api/v1/environments', {
        workspaceId: ident.workspaceId,
        name: `Env ${counter++}`,
        variables,
      })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  describe('{{variable}} resolution', () => {
    it('resolves a variable from the named environment', async () => {
      const environmentId = await createEnvironment(user, [
        { key: 'baseUrl', value: fixtureOrigin, enabled: true },
      ]);
      const id = await makeRequest(user, { url: '{{baseUrl}}/resolved' });

      let seenPath = '';
      handler = (req, res) => {
        seenPath = req.url ?? '';
        res.end('ok');
      };

      const result = resultOf(
        await send(user, id, { environmentId }).expect(200),
      );

      expect(seenPath).toBe('/resolved');
      expect(result.environmentId).toBe(environmentId);
      expect(result.warnings).toHaveLength(0);
    });

    it('warns and fails loudly when the URL variable is undefined', async () => {
      const id = await makeRequest(user, { url: '{{baseUrl}}/resolved' });

      const result = resultOf(
        await send(user, id, { environmentId: null }).expect(200),
      );

      // Left in place literally rather than substituted with the empty string,
      // which would have sent this to `/resolved` on some other host.
      expect(result.result).toMatchObject({
        outcome: 'failure',
        kind: 'invalid-url',
      });
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ kind: 'unresolved-variable' }),
      );
      expect(result.warnings[0].message).toContain('baseUrl');
    });

    it('applies the caller’s active environment when none is named', async () => {
      const environmentId = await createEnvironment(user, [
        { key: 'baseUrl', value: fixtureOrigin, enabled: true },
      ]);
      await as(user)
        .put(`/api/v1/workspaces/${user.workspaceId}/active-environment`, {
          environmentId,
        })
        .expect(200);

      const id = await makeRequest(user, { url: '{{baseUrl}}/active' });

      let seenPath = '';
      handler = (req, res) => {
        seenPath = req.url ?? '';
        res.end('ok');
      };

      // No `environmentId` in the body at all — omitted means "my active one".
      const result = resultOf(await send(user, id).expect(200));

      expect(seenPath).toBe('/active');
      expect(result.environmentId).toBe(environmentId);

      // Reset, so later tests are not affected by this preference.
      await as(user)
        .put(`/api/v1/workspaces/${user.workspaceId}/active-environment`, {
          environmentId: null,
        })
        .expect(200);
    });

    it('redacts a secret value from the stored url but not from the live result', async () => {
      const environmentId = await createEnvironment(user, [
        { key: 'apiKey', value: 'sup3rs3cret', enabled: true, secret: true },
      ]);
      const id = await makeRequest(user, {
        url: `${fixtureOrigin}/?token={{apiKey}}`,
      });

      const result = resultOf(
        await send(user, id, { environmentId }).expect(200),
      );

      // The person who pressed Send is entitled to see what they sent.
      expect(result.url).toContain('sup3rs3cret');

      const stored = await as(user)
        .get(`/api/v1/executions/${result.executionId!}`)
        .expect(200);
      expect((stored.body as { url: string }).url).not.toContain('sup3rs3cret');
    });
  });

  // ------------------------------------------------------------- scoping

  describe('scoping', () => {
    it('answers 404 for another user’s request id, not 403', async () => {
      // A 403 would confirm the id is real, which is all an attacker needs to
      // enumerate what exists across the whole system.
      const stranger = await signUp();
      const id = await makeRequest(user);

      const res = await send(stranger, id).expect(404);
      expect(errorBody(res).code).toBe(ApiErrorCode.NOT_FOUND);
    });

    // ⚠️ Resolving the environment through its own scope alone is not enough:
    // a member of two workspaces could otherwise inject workspace B's
    // variables — and so B's base URL and credentials — into a send from A.
    it('answers 404 for an environment belonging to a different workspace', async () => {
      const other = await signUp();
      const foreignEnvironment = await createEnvironment(other, [
        { key: 'baseUrl', value: 'http://elsewhere.test', enabled: true },
      ]);
      const id = await makeRequest(user);

      const res = await send(user, id, {
        environmentId: foreignEnvironment,
      }).expect(404);

      expect(errorBody(res).code).toBe(ApiErrorCode.NOT_FOUND);
    });

    it('answers 404 when setting an active environment from another workspace', async () => {
      const other = await signUp();
      const foreignEnvironment = await createEnvironment(other, []);

      await as(user)
        .put(`/api/v1/workspaces/${user.workspaceId}/active-environment`, {
          environmentId: foreignEnvironment,
        })
        .expect(404);
    });
  });

  // ------------------------------------------------------------- history

  describe('history', () => {
    it('records each send and lists it, newest first', async () => {
      const id = await makeRequest(user);
      await send(user, id).expect(200);
      await send(user, id).expect(200);

      const list = await as(user)
        .get(`/api/v1/requests/${id}/executions`)
        .expect(200);

      const body = list.body as {
        data: { id: string; status: number; url: string }[];
        meta: { total: number };
      };
      expect(body.meta.total).toBe(2);
      expect(body.data).toHaveLength(2);
      expect(body.data[0].status).toBe(200);
      // The list row carries no body, so it stays cheap.
      expect(body.data[0]).not.toHaveProperty('body');
    });

    it('caps stored runs per request', async () => {
      const id = await makeRequest(user);
      for (let i = 0; i < HISTORY_CAP + 2; i += 1) {
        await send(user, id).expect(200);
      }

      const list = await as(user)
        .get(`/api/v1/requests/${id}/executions`)
        .expect(200);

      expect((list.body as { meta: { total: number } }).meta.total).toBe(
        HISTORY_CAP,
      );
    });

    it('clears history for one request', async () => {
      const id = await makeRequest(user);
      await send(user, id).expect(200);

      await as(user).delete(`/api/v1/requests/${id}/executions`).expect(204);

      const list = await as(user)
        .get(`/api/v1/requests/${id}/executions`)
        .expect(200);
      expect((list.body as { meta: { total: number } }).meta.total).toBe(0);
    });

    it('hides another user’s execution behind a 404', async () => {
      const stranger = await signUp();
      const id = await makeRequest(user);
      const result = resultOf(await send(user, id).expect(200));

      await as(stranger)
        .get(`/api/v1/executions/${result.executionId!}`)
        .expect(404);
      await as(stranger).get(`/api/v1/requests/${id}/executions`).expect(404);
    });

    it('records a failure with its kind rather than a status', async () => {
      const id = await makeRequest(user, { url: BLOCKED_HOST });
      const result = resultOf(await send(user, id).expect(200));

      const stored = await as(user)
        .get(`/api/v1/executions/${result.executionId!}`)
        .expect(200);

      expect(stored.body).toMatchObject({
        outcome: 'failure',
        failureKind: 'blocked-address',
        status: null,
      });
    });
  });

  // ------------------------------------------------------------- validation

  describe('our own errors still use the envelope', () => {
    it('rejects a malformed draft with 400 VALIDATION_FAILED', async () => {
      const id = await makeRequest(user);

      const res = await send(user, id, {
        draft: { method: 'TELEPORT' },
      }).expect(400);

      expect(errorBody(res).code).toBe(ApiErrorCode.VALIDATION_FAILED);
    });

    it('rejects a non-uuid environmentId with 400', async () => {
      const id = await makeRequest(user);
      await send(user, id, { environmentId: 'not-a-uuid' }).expect(400);
    });

    it('requires authentication', async () => {
      const id = await makeRequest(user);
      await request(server)
        .post(`/api/v1/requests/${id}/send`)
        .send({})
        .expect(401);
    });
  });
});
