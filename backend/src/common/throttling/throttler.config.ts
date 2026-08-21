import { ConfigService } from '@nestjs/config';
import type { ThrottlerOptions } from '@nestjs/throttler';

/**
 * Two windows, not one, and both are applied to the same route.
 *
 * A single limit forces a bad choice: a short window generous enough for a
 * shared office NAT (`getTracker` keys on IP) leaves an attacker free to run
 * at that rate forever, while a long window tight enough to stop enumeration
 * locks out a legitimate burst — a user who mistypes their password twice and
 * a colleague signing up at the same desk. A burst window bounds the spike and
 * a sustained window bounds the total, and neither has to compromise.
 *
 * The defaults are deliberately loose enough not to interfere with real use
 * and tight enough that `POST /auth/register` stops being a practical
 * enumeration oracle: bulk-checking a list of addresses through a 20/hour
 * bucket is not worth an attacker's time.
 */
/**
 * The return type is narrowed to the object form rather than the library's
 * `ThrottlerModuleOptions`, which is a union with a bare array — callers (and
 * the spec) would otherwise have to cast before reading `throttlers`.
 */
export function buildThrottlerOptions(config: ConfigService): {
  throttlers: ThrottlerOptions[];
} {
  return {
    throttlers: [
      {
        name: 'burst',
        ttl: config.getOrThrow<number>('THROTTLE_BURST_TTL_MS'),
        limit: config.getOrThrow<number>('THROTTLE_BURST_LIMIT'),
      },
      {
        name: 'sustained',
        ttl: config.getOrThrow<number>('THROTTLE_SUSTAINED_TTL_MS'),
        limit: config.getOrThrow<number>('THROTTLE_SUSTAINED_LIMIT'),
      },
      /**
       * Send's own budget. The register windows above are sized for a signup
       * form — 5 a minute — and Send on that budget is unusable, while leaving
       * Send unthrottled makes an authenticated account a free scanning proxy.
       *
       * All four windows are registered in one universe, and each route opts
       * out of the pair that is not its own with a per-name `@SkipThrottle`.
       * That is what keeps a single `ThrottlerModule` registration (and so a
       * single storage) while giving the two routes genuinely separate budgets.
       */
      {
        name: 'sendBurst',
        ttl: config.getOrThrow<number>('SEND_THROTTLE_BURST_TTL_MS'),
        limit: config.getOrThrow<number>('SEND_THROTTLE_BURST_LIMIT'),
      },
      {
        name: 'sendSustained',
        ttl: config.getOrThrow<number>('SEND_THROTTLE_SUSTAINED_TTL_MS'),
        limit: config.getOrThrow<number>('SEND_THROTTLE_SUSTAINED_LIMIT'),
      },
    ],
  };
}

/** Skipped on every route that is not Send. */
export const SKIP_SEND_THROTTLERS = {
  sendBurst: true,
  sendSustained: true,
} as const;

/** Skipped on Send, which carries its own windows and its own tracker. */
export const SKIP_DEFAULT_THROTTLERS = {
  burst: true,
  sustained: true,
} as const;
