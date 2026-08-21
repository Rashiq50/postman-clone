import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import type { Socket } from 'node:net';
import type { TLSSocket } from 'node:tls';
import * as zlib from 'node:zlib';
import type {
  HttpMethod,
  RedirectHop,
  ResponseBodyPayload,
  ResponseHeader,
  SendFailure,
  SendResponse,
  SendTiming,
  SendWarning,
} from '@postman-clone/contracts';
import type { SendOptions } from './send-options';
import {
  BlockedAddressError,
  DnsFailureError,
  isAllowedProtocol,
  resolveAndScreen,
} from './ssrf';

/**
 * The transport: one buffered, size-capped, deadline-bounded HTTP round trip
 * with manual redirects and a pinned socket.
 *
 * ### Why `node:http` / `node:https` and not `fetch`
 *
 * `undici` is not a dependency (only `undici-types`, a `@types/node`
 * transitive). Node exposes `fetch` globally but does *not* expose undici's
 * `Agent`, so pinning a connection through `Agent({ connect: { lookup } })`
 * would mean a new production dependency — and this slice adds none.
 *
 * `http.request` / `https.request` forward unknown options through the agent to
 * `net.connect` / `tls.connect`, which accept a **`lookup`** option with the
 * `dns.lookup` signature. That is the pin, with zero new dependencies, and
 * crucially it keeps SNI and the `Host` header derived from the *hostname*, so
 * certificate validation stays correct. Setting `host: <ip>` by hand instead is
 * what breaks TLS verification.
 *
 * We also need manual redirects, suppressed decompression and byte-capped
 * streaming, all of which mean fighting `fetch` rather than using it.
 */

/** RFC 9110 token set. Anything else is not a header name. */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Headers the transport owns. A user-set value here either corrupts framing
 * (`Content-Length`, `Transfer-Encoding`) or lies about the destination
 * (`Host`).
 */
const FORBIDDEN_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'upgrade',
  'te',
]);

/** Stripped when a redirect crosses an origin. See `isSameOrigin`. */
const CREDENTIAL_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
]);

/**
 * Methods that conventionally carry no body. A body on one of these is **sent
 * verbatim** and warned about (`body-on-bodyless-method`), never dropped — the
 * same philosophy as not re-serialising malformed JSON. Deliberately unusual
 * requests are the point of a testing tool, and silently dropping the body
 * would be the surprise.
 */
export const BODYLESS_METHODS = new Set<HttpMethod>([
  'GET',
  'HEAD',
  'DELETE',
  'OPTIONS',
]);

const BINARY_CONTENT_TYPES = [
  'image/',
  'audio/',
  'video/',
  'font/',
  'application/octet-stream',
  'application/pdf',
  'application/zip',
];

export class HeaderValidationError extends Error {}

/**
 * Validates header names and values **after interpolation** and before
 * anything is written to a socket.
 *
 * ⚠️ **This exists *because of* interpolation.** A saved request is authored by
 * a human, but `{{token}}` can carry `x\r\nX-Admin: 1` straight out of an
 * environment variable. Node's own validation catches much of this by throwing
 * `ERR_INVALID_CHAR` — but relying on a thrown internal error to *be* the
 * security boundary is exactly the thing that quietly stops being true across a
 * Node upgrade.
 */
export function validateHeaders(headers: ResponseHeader[]): void {
  for (const { name, value } of headers) {
    if (!HEADER_NAME.test(name)) {
      throw new HeaderValidationError(
        `Header name "${name}" is not a valid HTTP header name`,
      );
    }
    if (FORBIDDEN_HEADERS.has(name.toLowerCase())) {
      throw new HeaderValidationError(
        `Header "${name}" is set by the transport and cannot be overridden`,
      );
    }
    if (/[\r\n\0]/.test(value)) {
      throw new HeaderValidationError(
        `Header "${name}" contains a line break or NUL byte`,
      );
    }
  }
}

/** Scheme, host and port must all match for credentials to survive a hop. */
export function isSameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.host === b.host;
}

/**
 * Decides text vs base64 for a buffered body or a header value.
 *
 * ⚠️ **Never `buf.toString('utf8')` as the test.** It substitutes U+FFFD for
 * invalid bytes and so always "succeeds", which turns every JPEG into
 * mojibake text. `TextDecoder` with `fatal: true` is the test.
 *
 * ⚠️ **And the fatal decoder does not close the hole by itself — `\0` is
 * *valid* UTF-8.** It decodes without throwing, and Postgres then rejects the
 * NUL byte on the history insert, turning a perfectly good send into a 500. So
 * decoded text containing `\0` falls to base64 too, exactly as if the decode
 * had failed.
 */
export function decodeBody(
  buffer: Buffer,
  contentType: string | undefined,
): ResponseBodyPayload {
  if (buffer.length === 0) return { encoding: 'empty' };

  const type = (contentType ?? '').toLowerCase();

  if (BINARY_CONTENT_TYPES.some((prefix) => type.startsWith(prefix))) {
    return { encoding: 'base64', base64: buffer.toString('base64') };
  }

  const charsetMatch = /charset=\s*"?([\w-]+)"?/.exec(type);
  const charset = charsetMatch?.[1] ?? 'utf-8';

  try {
    const text = new TextDecoder(charset, { fatal: true }).decode(buffer);
    if (text.includes('\0')) {
      return { encoding: 'base64', base64: buffer.toString('base64') };
    }
    return { encoding: 'text', text };
  } catch {
    return { encoding: 'base64', base64: buffer.toString('base64') };
  }
}

/** Response header values reach a jsonb column, so they get the same NUL rule. */
function sanitizeHeaderValue(value: string): string {
  return value.includes('\0') ? value.replace(/\0/g, '') : value;
}

function collectResponseHeaders(
  raw: http.IncomingHttpHeaders,
): ResponseHeader[] {
  const headers: ResponseHeader[] = [];
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    // `set-cookie` arrives as an array and legitimately repeats — which is why
    // this is an ordered list of pairs and not a map.
    for (const one of Array.isArray(value) ? value : [value]) {
      headers.push({ name, value: sanitizeHeaderValue(String(one)) });
    }
  }
  return headers;
}

export interface SendHttpInput {
  method: HttpMethod;
  /** Already interpolated, with query params appended. */
  url: string;
  /** Already interpolated and validated. */
  headers: ResponseHeader[];
  /** Already serialised, or null for no body. */
  body: Buffer | null;
}

export interface SendHttpOutcome {
  /** The final URL after every redirect. */
  finalUrl: string;
  redirects: RedirectHop[];
  warnings: SendWarning[];
  timing: SendTiming;
  result: SendResponse | SendFailure;
}

const failure = (
  kind: SendFailure['kind'],
  message: string,
): SendFailure => ({ outcome: 'failure', kind, message });

/** Maps a socket-level errno onto a `SendFailureKind`. Never leaks the stack. */
function classifyError(error: NodeJS.ErrnoException): SendFailure {
  const code = error.code ?? '';
  if (code.startsWith('ERR_TLS') || code.startsWith('CERT_') || code === 'EPROTO') {
    return failure('tls', `TLS handshake failed (${code || 'unknown'})`);
  }
  if (
    code === 'ECONNREFUSED' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'EACCES' ||
    code === 'ETIMEDOUT' ||
    code === 'EADDRNOTAVAIL'
  ) {
    return failure('connect', `Could not connect (${code})`);
  }
  if (code === 'ECONNRESET' || code === 'EPIPE') {
    return failure('aborted', 'The connection closed before the response finished');
  }
  return failure('unknown', 'The request failed for an unknown reason');
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const ms = (from: bigint, to: bigint): number => Number(to - from) / 1e6;

interface HopTimings {
  dnsMs: number | null;
  connectMs: number | null;
  tlsMs: number | null;
  firstByteMs: number | null;
}

interface HopResult {
  status: number;
  statusText: string;
  headers: ResponseHeader[];
  location: string | null;
  /** Present only on the final (non-redirect) hop. */
  body: { buffer: Buffer; bytes: number; truncated: boolean } | null;
  timings: HopTimings;
}

/**
 * One hop: screen, pin, connect, and either read the body or report a redirect.
 *
 * ⚠️ Called once **per hop**. A redirect is a fresh connection to a fresh name,
 * so reusing the previous hop's screening is the same TOCTOU hole in a
 * different coat.
 */
async function sendOneHop(
  url: URL,
  method: HttpMethod,
  headers: ResponseHeader[],
  body: Buffer | null,
  options: SendOptions,
  deadlineAt: number,
  followRedirect: boolean,
): Promise<HopResult> {
  if (!isAllowedProtocol(url.protocol)) {
    throw new InvalidUrlError(`Unsupported scheme "${url.protocol}"`);
  }

  const dnsStart = process.hrtime.bigint();
  const screened = await resolveAndScreen(url.hostname, options);
  const dnsDone = process.hrtime.bigint();
  const isLiteral = net.isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0;

  const pinned = screened[0];
  const pinnedFamily = net.isIPv6(pinned) ? 6 : 4;

  // The pin. Node forwards this through the agent to net.connect/tls.connect,
  // so the hostname still drives SNI and the Host header while the packets go
  // to the address we screened.
  const lookup: net.LookupFunction = (_hostname, opts, callback) => {
    if ((opts as { all?: boolean })?.all) {
      (callback as unknown as (
        err: null,
        addresses: { address: string; family: number }[],
      ) => void)(null, [{ address: pinned, family: pinnedFamily }]);
    } else {
      callback(null, pinned, pinnedFamily);
    }
  };

  const secure = url.protocol === 'https:';
  const transport = secure ? https : http;

  const outgoing: http.RequestOptions = {
    protocol: url.protocol,
    hostname: url.hostname.replace(/^\[|\]$/g, ''),
    port: url.port || (secure ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    method,
    headers: {
      ...Object.fromEntries(headers.map((h) => [h.name, h.value])),
      // ⚠️ The transport owns `Content-Length`, and setting it explicitly is
      // load-bearing rather than tidy: Node sets `useChunkedEncodingByDefault`
      // to false for GET/HEAD/DELETE/OPTIONS, so a body written on one of those
      // without a length is framed by nothing and **silently dropped**. That is
      // exactly the "send it verbatim" case we promise not to swallow.
      ...(body ? { 'content-length': String(body.length) } : {}),
    },
    lookup,
    // A fresh agent per send. Pooled sockets across tenants are not wanted
    // anyway, and a pooled socket could outlive the screening that cleared it.
    agent: false,
  };

  return await new Promise<HopResult>((resolve, reject) => {
    const timings: HopTimings = {
      dnsMs: isLiteral ? null : ms(dnsStart, dnsDone),
      connectMs: null,
      tlsMs: null,
      firstByteMs: null,
    };

    let settled = false;
    const connectStart = process.hrtime.bigint();
    let tlsStart: bigint | null = null;

    const request = transport.request(outgoing);

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      request.destroy();
      reject(error);
    };

    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      fail(new TotalTimeoutError());
      return;
    }
    // ⚠️ One absolute deadline, spanning every hop. A per-hop timeout under a
    // 5-hop cap is a 5x timeout, and this is also what bounds a slowloris
    // response body — which a connect timeout does not.
    const deadline = setTimeout(() => fail(new TotalTimeoutError()), remaining);
    deadline.unref?.();

    request.on('socket', (socket: Socket) => {
      socket.setTimeout(options.connectTimeoutMs, () => {
        if (timings.connectMs === null) {
          fail(
            Object.assign(new Error('connect timeout'), { code: 'ETIMEDOUT' }),
          );
        }
      });

      const onConnected = () => {
        timings.connectMs = ms(connectStart, process.hrtime.bigint());
        // Belt and braces: this costs nothing and it is the assertion that
        // catches a future refactor that drops the `lookup`.
        const actual = socket.remoteAddress;
        if (actual && normalizeAddress(actual) !== normalizeAddress(pinned)) {
          socket.destroy();
          fail(new BlockedAddressError(actual));
          return;
        }
        socket.setTimeout(0);
        if (secure) tlsStart = process.hrtime.bigint();
      };

      socket.once('connect', onConnected);
      if (secure) {
        (socket as TLSSocket).once('secureConnect', () => {
          if (tlsStart !== null) {
            timings.tlsMs = ms(tlsStart, process.hrtime.bigint());
          }
          socket.setTimeout(0);
        });
      }
    });

    request.on('error', (error: NodeJS.ErrnoException) => fail(error));

    request.on('response', (response: http.IncomingMessage) => {
      timings.firstByteMs = ms(connectStart, process.hrtime.bigint());

      const status = response.statusCode ?? 0;
      const statusText = response.statusMessage ?? '';
      const responseHeaders = collectResponseHeaders(response.headers);
      const location = response.headers.location ?? null;

      if (followRedirect && REDIRECT_STATUSES.has(status) && location) {
        // Nothing of the body is wanted; drop the connection rather than
        // buffering a redirect page we will never show.
        settled = true;
        clearTimeout(deadline);
        response.destroy();
        request.destroy();
        resolve({
          status,
          statusText,
          headers: responseHeaders,
          location,
          body: null,
          timings,
        });
        return;
      }

      const chunks: Buffer[] = [];
      let bytes = 0;
      let truncated = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        resolve({
          status,
          statusText,
          headers: responseHeaders,
          location: null,
          body: { buffer: Buffer.concat(chunks), bytes, truncated },
          timings,
        });
      };

      const stream = decompressionStream(response, options.maxResponseBytes);

      stream.on('data', (chunk: Buffer) => {
        if (settled) return;
        const room = options.maxResponseBytes - bytes;
        if (chunk.length >= room) {
          // **Overflow is a success, not a failure.** The status line already
          // arrived and is the useful part; turning it into a failure throws
          // away the answer.
          chunks.push(chunk.subarray(0, room));
          bytes += room;
          truncated = true;
          response.destroy();
          request.destroy();
          finish();
          return;
        }
        chunks.push(chunk);
        bytes += chunk.length;
      });

      stream.on('end', finish);

      stream.on('error', (error: NodeJS.ErrnoException) => {
        // zlib's own overflow guard is a backstop behind the byte counter
        // above. Either way it means "we stopped early", not "the send failed".
        if (error.code === 'ERR_BUFFER_TOO_LARGE') {
          truncated = true;
          finish();
          return;
        }
        fail(error);
      });

      response.on('aborted', () => {
        if (!settled && !truncated) {
          fail(Object.assign(new Error('aborted'), { code: 'ECONNRESET' }));
        }
      });
    });

    // A body on a bodyless method is sent **verbatim**, not dropped — see
    // `BODYLESS_METHODS`. Deliberately unusual requests are the point of a
    // testing tool; the caller has already emitted the warning.
    if (body) request.write(body);
    request.end();
  });
}

/** `::ffff:127.0.0.1` and `127.0.0.1` are the same peer to a dual-stack socket. */
function normalizeAddress(address: string): string {
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

/**
 * We ask for `identity`, so this usually returns the response untouched. If the
 * target compresses anyway, the decompressor carries `maxOutputLength` —
 * ⚠️ because a cap on *compressed* bytes is not a cap at all, and a 5 MiB gzip
 * is a gigabyte of RAM.
 */
function decompressionStream(
  response: http.IncomingMessage,
  maxOutputLength: number,
): NodeJS.ReadableStream {
  const encoding = String(response.headers['content-encoding'] ?? '')
    .trim()
    .toLowerCase();

  switch (encoding) {
    case 'gzip':
    case 'x-gzip':
      return response.pipe(zlib.createGunzip({ maxOutputLength }));
    case 'deflate':
      return response.pipe(zlib.createInflate({ maxOutputLength }));
    case 'br':
      return response.pipe(zlib.createBrotliDecompress({ maxOutputLength }));
    default:
      return response;
  }
}

export class InvalidUrlError extends Error {}
export class TotalTimeoutError extends Error {}
export class TooManyRedirectsError extends Error {}

/**
 * Follows redirects manually and returns one `SendResponse` or `SendFailure`.
 *
 * ⚠️ **A cross-origin hop strips `Authorization`, `Cookie` and
 * `Proxy-Authorization`.** Forwarding a bearer token to whatever host a
 * redirect names is a credential-exfiltration primitive, and it is the default
 * behaviour of every naive implementation.
 */
export async function sendHttp(
  input: SendHttpInput,
  options: SendOptions,
): Promise<SendHttpOutcome> {
  const startedAt = process.hrtime.bigint();
  const deadlineAt = Date.now() + options.totalTimeoutMs;
  const redirects: RedirectHop[] = [];
  const warnings: SendWarning[] = [];

  // Declared before the URL parse below: the invalid-url path returns through
  // `done`, which reads it.
  let timings: HopTimings = {
    dnsMs: null,
    connectMs: null,
    tlsMs: null,
    firstByteMs: null,
  };

  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return done(
      failure('invalid-url', `"${input.url}" is not a valid URL`),
      input.url,
    );
  }

  let method = input.method;
  let headers = [...input.headers];
  let body = input.body;

  function done(
    result: SendResponse | SendFailure,
    finalUrl: string,
  ): SendHttpOutcome {
    return {
      finalUrl,
      redirects,
      warnings,
      timing: {
        totalMs: ms(startedAt, process.hrtime.bigint()),
        ...timings,
      } satisfies SendTiming,
      result,
    };
  }

  for (let hop = 0; ; hop += 1) {
    let outcome: HopResult;
    try {
      outcome = await sendOneHop(
        url,
        method,
        headers,
        body,
        options,
        deadlineAt,
        hop < options.maxRedirects,
      );
    } catch (error) {
      return done(classifyThrow(error, options), url.toString());
    }

    timings = outcome.timings;

    if (!outcome.location) {
      if (!outcome.body) {
        return done(
          failure('unknown', 'The response could not be read'),
          url.toString(),
        );
      }
      if (REDIRECT_STATUSES.has(outcome.status) && hop >= options.maxRedirects) {
        return done(
          failure(
            'too-many-redirects',
            `Stopped after ${options.maxRedirects} redirects`,
          ),
          url.toString(),
        );
      }
      if (outcome.body.truncated) {
        warnings.push({
          kind: 'body-truncated',
          message: `The response was larger than ${options.maxResponseBytes} bytes and was truncated.`,
        });
      }
      const contentType = outcome.headers.find(
        (header) => header.name.toLowerCase() === 'content-type',
      )?.value;

      return done(
        {
          outcome: 'response',
          status: outcome.status,
          statusText: outcome.statusText,
          headers: outcome.headers,
          body: decodeBody(outcome.body.buffer, contentType),
          bodyBytes: outcome.body.bytes,
          bodyTruncated: outcome.body.truncated,
        },
        url.toString(),
      );
    }

    let next: URL;
    try {
      next = new URL(outcome.location, url);
    } catch {
      return done(
        failure('invalid-url', `Redirect target "${outcome.location}" is not a valid URL`),
        url.toString(),
      );
    }
    if (!isAllowedProtocol(next.protocol)) {
      return done(
        failure(
          'invalid-url',
          `Redirect to unsupported scheme "${next.protocol}"`,
        ),
        url.toString(),
      );
    }

    redirects.push({
      status: outcome.status,
      from: url.toString(),
      to: next.toString(),
    });

    if (!isSameOrigin(url, next)) {
      const stripped = headers.filter((header) =>
        CREDENTIAL_HEADERS.has(header.name.toLowerCase()),
      );
      if (stripped.length > 0) {
        headers = headers.filter(
          (header) => !CREDENTIAL_HEADERS.has(header.name.toLowerCase()),
        );
        warnings.push({
          kind: 'auth-stripped-on-cross-origin-redirect',
          message: `Redirect to ${next.origin} crossed origins, so ${stripped
            .map((header) => header.name)
            .join(', ')} was not forwarded.`,
        });
      }
    }

    // 301/302 on POST and 303 on anything become GET with no body; 307/308
    // replay method and body verbatim (we buffer the body anyway, so a replay
    // is free).
    if (
      outcome.status === 303 ||
      ((outcome.status === 301 || outcome.status === 302) && method !== 'GET' && method !== 'HEAD')
    ) {
      method = 'GET';
      body = null;
      headers = headers.filter(
        (header) => header.name.toLowerCase() !== 'content-type',
      );
    }

    url = next;
  }
}

function classifyThrow(error: unknown, options: SendOptions): SendFailure {
  if (error instanceof BlockedAddressError) {
    return failure(
      'blocked-address',
      `The address ${error.address} is not allowed. Sending to private, loopback and link-local addresses is blocked.`,
    );
  }
  if (error instanceof DnsFailureError) {
    return failure('dns', `Could not resolve "${error.hostname}"`);
  }
  if (error instanceof InvalidUrlError) {
    return failure('invalid-url', error.message);
  }
  if (error instanceof TotalTimeoutError) {
    return failure(
      'timeout',
      `The request did not finish within ${options.totalTimeoutMs} ms`,
    );
  }
  if (error instanceof TooManyRedirectsError) {
    return failure(
      'too-many-redirects',
      `Stopped after ${options.maxRedirects} redirects`,
    );
  }
  return classifyError(error as NodeJS.ErrnoException);
}
