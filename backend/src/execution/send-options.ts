import type { ConfigService } from '@nestjs/config';
import { isBlockedAddress } from './ssrf';

/**
 * Every `SEND_*` knob, resolved once and injected — mirroring
 * `buildThrottlerOptions` / `THROTTLER_OPTIONS` exactly.
 *
 * ⚠️ **This indirection is not decoration.** `ConfigModule.forRoot()` reads and
 * validates the environment while the `@Module` decorator is *evaluated* — at
 * import time — so `process.env.SEND_ALLOW_PRIVATE_NETWORK = 'true'` at the top
 * of a spec is always too late. That is the identical trap already recorded for
 * `THROTTLER_OPTIONS`, and it is not theoretical here: `send.e2e-spec.ts` runs
 * a real `http.createServer` on `127.0.0.1`, which the default policy blocks.
 * Tests must override the `SEND_OPTIONS` **provider**, never `process.env`.
 */
export const SEND_OPTIONS = Symbol('SEND_OPTIONS');

export interface SendOptions {
  /** ⚠️ Development only. Skips address screening; see `ssrf.ts`. */
  allowPrivateNetwork: boolean;
  connectTimeoutMs: number;
  /** One absolute deadline across every redirect hop. */
  totalTimeoutMs: number;
  maxRedirects: number;
  /** ⚠️ Decompressed bytes. */
  maxResponseBytes: number;
  maxRequestBodyBytes: number;
  maxStoredBodyBytes: number;
  historyPerRequest: number;
  historyRetentionDays: number;
  /**
   * The screening predicate itself, defaulting to `ssrf.ts`'s real table.
   *
   * ⚠️ **The predicate is part of the options, and that is what makes the e2e
   * suite expressible at all.** A bare `allowPrivateNetwork: boolean` cannot
   * cover it: the happy-path tests need `127.0.0.1` (the fixture) *allowed*,
   * the blocked-address test needs one *blocked*, and the redirect test needs
   * hop 1 allowed while hop 2 is blocked — and locally both hops are loopback.
   * With the predicate injectable, one override serves all three: allow
   * `127.0.0.1`, block a marker address (`127.0.0.2`, still loopback, nothing
   * bound to it). Production never overrides it.
   */
  isBlockedAddress: (ip: string) => boolean;
}

export function buildSendOptions(config: ConfigService): SendOptions {
  return {
    allowPrivateNetwork: config.getOrThrow<boolean>(
      'SEND_ALLOW_PRIVATE_NETWORK',
    ),
    connectTimeoutMs: config.getOrThrow<number>('SEND_CONNECT_TIMEOUT_MS'),
    totalTimeoutMs: config.getOrThrow<number>('SEND_TOTAL_TIMEOUT_MS'),
    maxRedirects: config.getOrThrow<number>('SEND_MAX_REDIRECTS'),
    maxResponseBytes: config.getOrThrow<number>('SEND_MAX_RESPONSE_BYTES'),
    maxRequestBodyBytes: config.getOrThrow<number>(
      'SEND_MAX_REQUEST_BODY_BYTES',
    ),
    maxStoredBodyBytes: config.getOrThrow<number>('SEND_MAX_STORED_BODY_BYTES'),
    historyPerRequest: config.getOrThrow<number>('SEND_HISTORY_PER_REQUEST'),
    historyRetentionDays: config.getOrThrow<number>(
      'SEND_HISTORY_RETENTION_DAYS',
    ),
    isBlockedAddress,
  };
}
