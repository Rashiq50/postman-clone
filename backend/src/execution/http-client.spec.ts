import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as zlib from 'node:zlib';
import type { SendResponse } from '@raven/contracts';
import {
  decodeBody,
  HeaderValidationError,
  isSameOrigin,
  sendHttp,
  validateHeaders,
} from './http-client';
import type { SendOptions } from './send-options';
import { isBlockedAddress } from './ssrf';

/**
 * These tests drive a real `http.createServer` on loopback, which the real
 * policy blocks — so they inject a predicate that allows `127.0.0.1` and
 * blocks `127.0.0.2`, exactly as `send.e2e-spec.ts` does. That the predicate
 * is part of `SendOptions` is what makes "allowed and blocked coexist in one
 * suite" expressible at all.
 */
const testOptions = (overrides: Partial<SendOptions> = {}): SendOptions => ({
  allowPrivateNetwork: false,
  connectTimeoutMs: 2000,
  totalTimeoutMs: 5000,
  maxRedirects: 5,
  maxResponseBytes: 1024 * 1024,
  maxRequestBodyBytes: 1024 * 1024,
  maxStoredBodyBytes: 4096,
  historyPerRequest: 50,
  historyRetentionDays: 30,
  isBlockedAddress: (ip) => ip === '127.0.0.2',
  ...overrides,
});

describe('validateHeaders', () => {
  it('accepts an ordinary header', () => {
    expect(() =>
      validateHeaders([{ name: 'X-Api-Key', value: 'abc' }]),
    ).not.toThrow();
  });

  it.each([['Bad Header'], ['X:Y'], ['']])(
    'rejects the invalid header name %p',
    (name) => {
      expect(() => validateHeaders([{ name, value: 'v' }])).toThrow(
        HeaderValidationError,
      );
    },
  );

  // ⚠️ The whole reason this function exists: a saved request is authored by a
  // human, but `{{token}}` can carry `\r\n` straight out of an environment.
  it.each([
    ['x\r\nX-Admin: 1'],
    ['x\nX-Admin: 1'],
    ['x\rX-Admin: 1'],
    ['x\0y'],
  ])('rejects the injected value %p', (value) => {
    expect(() => validateHeaders([{ name: 'X-Token', value }])).toThrow(
      HeaderValidationError,
    );
  });

  it.each([
    ['Host'],
    ['content-length'],
    ['Connection'],
    ['Transfer-Encoding'],
    ['Upgrade'],
    ['TE'],
  ])('refuses %s, which the transport owns', (name) => {
    expect(() => validateHeaders([{ name, value: 'x' }])).toThrow(
      HeaderValidationError,
    );
  });
});

describe('decodeBody', () => {
  it('reports an empty body as empty', () => {
    expect(decodeBody(Buffer.alloc(0), 'text/plain')).toEqual({
      encoding: 'empty',
    });
  });

  it('decodes utf-8 text', () => {
    expect(decodeBody(Buffer.from('héllo'), 'text/plain; charset=utf-8')).toEqual(
      { encoding: 'text', text: 'héllo' },
    );
  });

  it('falls back to base64 for bytes that are not valid utf-8', () => {
    // ⚠️ `buf.toString('utf8')` would "succeed" here by substituting U+FFFD,
    // which is what turns every JPEG into mojibake.
    const jpegish = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    expect(decodeBody(jpegish, 'application/json')).toEqual({
      encoding: 'base64',
      base64: jpegish.toString('base64'),
    });
  });

  it('falls back to base64 for text containing NUL, which is valid utf-8', () => {
    // ⚠️ The fatal decoder passes `a\0b` happily; Postgres then rejects the NUL
    // on the history insert and a good send becomes a 500.
    const withNul = Buffer.from([0x61, 0x00, 0x62]);
    expect(decodeBody(withNul, 'text/plain')).toEqual({
      encoding: 'base64',
      base64: withNul.toString('base64'),
    });
  });

  it.each([
    ['image/png'],
    ['application/octet-stream'],
    ['application/pdf'],
    ['audio/mpeg'],
    ['video/mp4'],
    ['font/woff2'],
  ])('does not even attempt to decode %s', (contentType) => {
    const buffer = Buffer.from('not really binary');
    expect(decodeBody(buffer, contentType)).toEqual({
      encoding: 'base64',
      base64: buffer.toString('base64'),
    });
  });

  it('honours a declared charset', () => {
    expect(
      decodeBody(Buffer.from([0xe9]), 'text/plain; charset=iso-8859-1'),
    ).toEqual({ encoding: 'text', text: 'é' });
  });
});

describe('isSameOrigin', () => {
  it.each([
    ['https://a.test/x', 'https://a.test/y', true],
    ['https://a.test/x', 'https://b.test/y', false],
    ['https://a.test/x', 'http://a.test/y', false],
    ['https://a.test:8443/x', 'https://a.test/y', false],
  ])('%s vs %s → %s', (a, b, expected) => {
    expect(isSameOrigin(new URL(a), new URL(b))).toBe(expected);
  });
});

describe('sendHttp', () => {
  let server: http.Server;
  let origin: string;
  let handler: http.RequestListener;
  let sockets: number;

  beforeAll(async () => {
    server = http.createServer((req, res) => handler(req, res));
    server.on('connection', () => {
      sockets += 1;
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    sockets = 0;
    handler = (_req, res) => res.end('ok');
  });

  const send = (
    url: string,
    overrides: Partial<SendOptions> = {},
    input: Partial<Parameters<typeof sendHttp>[0]> = {},
  ) =>
    sendHttp(
      { method: 'GET', url, headers: [], body: null, ...input },
      testOptions(overrides),
    );

  const asResponse = (result: unknown): SendResponse => {
    const outcome = result as SendResponse;
    expect(outcome.outcome).toBe('response');
    return outcome;
  };

  it('performs a plain request and returns status, headers and body', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    };

    const outcome = await send(`${origin}/thing`);
    const response = asResponse(outcome.result);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ encoding: 'text', text: '{"ok":true}' });
    expect(
      response.headers.find((h) => h.name === 'content-type')?.value,
    ).toContain('application/json');
    expect(outcome.finalUrl).toBe(`${origin}/thing`);
  });

  it('returns an upstream 500 as a response, not a failure', async () => {
    handler = (_req, res) => {
      res.writeHead(500);
      res.end('boom');
    };

    const response = asResponse((await send(`${origin}/`)).result);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ encoding: 'text', text: 'boom' });
  });

  it('sends the request body and the given headers', async () => {
    let seen: { body: string; header: string | undefined } | null = null;
    handler = (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        seen = {
          body: Buffer.concat(chunks).toString(),
          header: req.headers['x-api-key'] as string | undefined,
        };
        res.end('ok');
      });
    };

    await send(`${origin}/`, {}, {
      method: 'POST',
      headers: [{ name: 'X-Api-Key', value: 'abc' }],
      body: Buffer.from('hello'),
    });

    expect(seen).toEqual({ body: 'hello', header: 'abc' });
  });

  // ⚠️ The pin proves itself here: `lookup` returns an address the hostname
  // does not resolve to, and the connection must land there. This is the test
  // that catches a future refactor dropping the `lookup` option.
  it('connects to the pinned address rather than re-resolving the hostname', async () => {
    handler = (_req, res) => res.end('pinned');

    const port = (server.address() as AddressInfo).port;
    const outcome = await sendHttp(
      {
        method: 'GET',
        url: `http://127.0.0.1:${port}/`,
        headers: [],
        body: null,
      },
      testOptions(),
    );

    expect(asResponse(outcome.result).body).toEqual({
      encoding: 'text',
      text: 'pinned',
    });
    expect(sockets).toBe(1);
  });

  it('blocks a screened address before any socket is opened', async () => {
    const outcome = await send('http://127.0.0.2/');

    expect(outcome.result).toEqual({
      outcome: 'failure',
      kind: 'blocked-address',
      message: expect.stringContaining('127.0.0.2') as string,
    });
    expect(sockets).toBe(0);
  });

  it('reports a refused connection as a failure, not as an error of ours', async () => {
    // Port 1 on the allowed loopback address: nothing is listening.
    const outcome = await send('http://127.0.0.1:1/');
    expect(outcome.result).toMatchObject({
      outcome: 'failure',
      kind: 'connect',
    });
  });

  it('rejects an unparseable URL', async () => {
    const outcome = await send('not a url');
    expect(outcome.result).toMatchObject({
      outcome: 'failure',
      kind: 'invalid-url',
    });
  });

  it.each([['file:///etc/passwd'], ['ftp://example.test/x'], ['data:text/plain,x']])(
    'rejects the unsupported scheme in %s',
    async (url) => {
      const outcome = await send(url);
      expect(outcome.result).toMatchObject({
        outcome: 'failure',
        kind: 'invalid-url',
      });
    },
  );

  it('follows a redirect and records the hop', async () => {
    handler = (req, res) => {
      if (req.url === '/from') {
        res.writeHead(302, { location: '/to' });
        res.end();
        return;
      }
      res.end('arrived');
    };

    const outcome = await send(`${origin}/from`);

    expect(asResponse(outcome.result).body).toEqual({
      encoding: 'text',
      text: 'arrived',
    });
    expect(outcome.redirects).toEqual([
      { status: 302, from: `${origin}/from`, to: `${origin}/to` },
    ]);
    expect(outcome.finalUrl).toBe(`${origin}/to`);
  });

  // ⚠️ Every hop re-screens. The first hop's clearance says nothing about the
  // second's — reusing it is the same TOCTOU hole in a different coat.
  it('re-screens each redirect hop and blocks a hop to a blocked address', async () => {
    handler = (_req, res) => {
      res.writeHead(302, { location: 'http://127.0.0.2/' });
      res.end();
    };

    const outcome = await send(`${origin}/`);

    expect(outcome.result).toMatchObject({
      outcome: 'failure',
      kind: 'blocked-address',
    });
    expect(outcome.redirects).toHaveLength(1);
  });

  it('caps the redirect chain', async () => {
    let n = 0;
    handler = (_req, res) => {
      n += 1;
      res.writeHead(302, { location: `/hop${n}` });
      res.end();
    };

    const outcome = await send(`${origin}/`, { maxRedirects: 2 });

    expect(outcome.result).toMatchObject({
      outcome: 'failure',
      kind: 'too-many-redirects',
    });
    expect(outcome.redirects).toHaveLength(2);
  });

  it('turns a 302 on POST into a GET with no body', async () => {
    const methods: string[] = [];
    handler = (req, res) => {
      methods.push(req.method ?? '');
      if (req.url === '/from') {
        res.writeHead(302, { location: '/to' });
        res.end();
        return;
      }
      res.end('done');
    };

    await send(`${origin}/from`, {}, {
      method: 'POST',
      body: Buffer.from('payload'),
    });

    expect(methods).toEqual(['POST', 'GET']);
  });

  it('replays method and body verbatim on a 307', async () => {
    const seen: { method: string; body: string }[] = [];
    handler = (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        seen.push({
          method: req.method ?? '',
          body: Buffer.concat(chunks).toString(),
        });
        if (req.url === '/from') {
          res.writeHead(307, { location: '/to' });
          res.end();
          return;
        }
        res.end('done');
      });
    };

    await send(`${origin}/from`, {}, {
      method: 'POST',
      body: Buffer.from('payload'),
    });

    expect(seen).toEqual([
      { method: 'POST', body: 'payload' },
      { method: 'POST', body: 'payload' },
    ]);
  });

  // ⚠️ Forwarding a bearer token to whatever host a redirect names is a
  // credential-exfiltration primitive, and the default of every naive client.
  it('strips credential headers on a cross-origin redirect and warns', async () => {
    const other = http.createServer((_req, res) => res.end('elsewhere'));
    await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
    const otherPort = (other.address() as AddressInfo).port;
    let forwarded: string | undefined = 'not-called';
    other.removeAllListeners('request');
    other.on('request', (req, res) => {
      forwarded = req.headers.authorization;
      res.end('elsewhere');
    });

    handler = (_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${otherPort}/` });
      res.end();
    };

    const outcome = await send(`${origin}/`, {}, {
      headers: [
        { name: 'Authorization', value: 'Bearer secret' },
        { name: 'X-Keep', value: 'kept' },
      ],
    });

    expect(forwarded).toBeUndefined();
    expect(outcome.warnings).toContainEqual({
      kind: 'auth-stripped-on-cross-origin-redirect',
      message: expect.stringContaining('Authorization') as string,
    });

    await new Promise<void>((resolve) => other.close(() => resolve()));
  });

  it('keeps credential headers on a same-origin redirect', async () => {
    let forwarded: string | undefined;
    handler = (req, res) => {
      if (req.url === '/from') {
        res.writeHead(302, { location: '/to' });
        res.end();
        return;
      }
      forwarded = req.headers.authorization;
      res.end('done');
    };

    const outcome = await send(`${origin}/from`, {}, {
      headers: [{ name: 'Authorization', value: 'Bearer secret' }],
    });

    expect(forwarded).toBe('Bearer secret');
    expect(outcome.warnings).toHaveLength(0);
  });

  // **Overflow is a success, not a failure** — the status line already arrived
  // and is the useful part.
  it('truncates an over-cap body but still returns the response', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('x'.repeat(5000));
    };

    const outcome = await send(`${origin}/`, { maxResponseBytes: 100 });
    const response = asResponse(outcome.result);

    expect(response.status).toBe(200);
    expect(response.bodyTruncated).toBe(true);
    expect(response.bodyBytes).toBe(100);
    expect(outcome.warnings).toContainEqual(
      expect.objectContaining({ kind: 'body-truncated' }),
    );
  });

  // ⚠️ The cap is on decompressed bytes. A cap on compressed bytes is not a cap.
  it('caps decompressed bytes when the target compresses anyway', async () => {
    handler = (_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'content-encoding': 'gzip',
      });
      res.end(zlib.gzipSync(Buffer.alloc(200_000, 0x61)));
    };

    const outcome = await send(`${origin}/`, { maxResponseBytes: 1000 });
    const response = asResponse(outcome.result);

    expect(response.status).toBe(200);
    expect(response.bodyTruncated).toBe(true);
    expect(response.bodyBytes).toBeLessThanOrEqual(1000);
  });

  it('decompresses a gzip response that fits under the cap', async () => {
    handler = (_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'content-encoding': 'gzip',
      });
      res.end(zlib.gzipSync(Buffer.from('compressed hello')));
    };

    const response = asResponse((await send(`${origin}/`)).result);
    expect(response.body).toEqual({
      encoding: 'text',
      text: 'compressed hello',
    });
  });

  it('fails with a timeout when the total deadline elapses', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('slow');
      // Never ends: exactly the slowloris a connect timeout does not bound.
    };

    const outcome = await send(`${origin}/`, { totalTimeoutMs: 300 });
    expect(outcome.result).toMatchObject({ outcome: 'failure', kind: 'timeout' });
  });

  it('reports an empty body from HEAD as empty, with no wait for one', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end();
    };

    const response = asResponse(
      (await send(`${origin}/`, {}, { method: 'HEAD' })).result,
    );
    expect(response.body).toEqual({ encoding: 'empty' });
  });

  it('sends a body on a bodyless method verbatim rather than dropping it', async () => {
    let received = '';
    handler = (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received = Buffer.concat(chunks).toString();
        res.end('ok');
      });
    };

    await send(`${origin}/`, {}, {
      method: 'DELETE',
      body: Buffer.from('deliberate'),
    });

    expect(received).toBe('deliberate');
  });

  it('reports repeated set-cookie headers as separate ordered pairs', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'set-cookie': ['a=1', 'b=2'] });
      res.end('ok');
    };

    const response = asResponse((await send(`${origin}/`)).result);
    expect(
      response.headers.filter((h) => h.name === 'set-cookie'),
    ).toEqual([
      { name: 'set-cookie', value: 'a=1' },
      { name: 'set-cookie', value: 'b=2' },
    ]);
  });

  it('reports timings for the final hop', async () => {
    const outcome = await send(`${origin}/`);

    expect(outcome.timing.totalMs).toBeGreaterThan(0);
    // A literal IP does no lookup, so `dnsMs` is null rather than 0.
    expect(outcome.timing.dnsMs).toBeNull();
    expect(outcome.timing.connectMs).not.toBeNull();
    // Plain http, so no handshake happened.
    expect(outcome.timing.tlsMs).toBeNull();
    expect(outcome.timing.firstByteMs).not.toBeNull();
  });

  it('reports a DNS failure as dns, not as blocked', async () => {
    const outcome = await send(
      'http://this-name-does-not-exist.invalid/',
      { isBlockedAddress },
    );
    expect(outcome.result).toMatchObject({ outcome: 'failure', kind: 'dns' });
  });
});
