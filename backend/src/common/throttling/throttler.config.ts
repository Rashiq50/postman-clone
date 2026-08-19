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
    ],
  };
}
