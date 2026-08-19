import { ConfigService } from '@nestjs/config';
import type { ValidationResult } from 'joi';
import { envValidationSchema } from '../../config/env.validation';
import { buildThrottlerOptions } from './throttler.config';

/**
 * The e2e suites override `THROTTLER_OPTIONS` outright, so this is the only
 * place the environment-to-options wiring is checked. A typo in a variable
 * name here would otherwise surface as a `getOrThrow` at boot — or, worse, as
 * a limit that is quietly the wrong one.
 */
describe('buildThrottlerOptions', () => {
  const configFrom = (env: Record<string, string>) => {
    // Joi types its result as `any`; casting once here keeps the rest of the
    // file type-checked.
    const result = envValidationSchema.validate(
      {
        DB_HOST: 'localhost',
        DB_USERNAME: 'postgres',
        DB_PASSWORD: '',
        DB_NAME: 'postman_clone',
        JWT_ACCESS_SECRET: 'a'.repeat(32),
        REFRESH_TOKEN_EXPIRES_IN: '30d',
        AUTH_COOKIE_NAME: 'pc_refresh_token',
        ...env,
      },
      { abortEarly: false, allowUnknown: true },
    ) as ValidationResult<Record<string, unknown>>;

    if (result.error) throw result.error;
    return new ConfigService(result.value);
  };

  it('builds a burst window and a sustained window from the environment', () => {
    const options = buildThrottlerOptions(
      configFrom({
        THROTTLE_BURST_TTL_MS: '1000',
        THROTTLE_BURST_LIMIT: '2',
        THROTTLE_SUSTAINED_TTL_MS: '9000',
        THROTTLE_SUSTAINED_LIMIT: '7',
      }),
    );

    expect(options.throttlers).toEqual([
      { name: 'burst', ttl: 1000, limit: 2 },
      { name: 'sustained', ttl: 9000, limit: 7 },
    ]);
  });

  /**
   * The defaults matter as much as the overrides: nothing in `.env` sets these,
   * so a deployment that never heard of them still gets a real limit rather
   * than a boot failure or an unbounded route.
   */
  it('falls back to shipped defaults when nothing is configured', () => {
    const options = buildThrottlerOptions(configFrom({}));

    expect(options.throttlers).toEqual([
      { name: 'burst', ttl: 60000, limit: 5 },
      { name: 'sustained', ttl: 3600000, limit: 20 },
    ]);
  });

  // A burst window that outlasts the sustained one is a misconfiguration the
  // two-window design cannot express; the ordering is what makes them a pair.
  it('keeps the burst window shorter and tighter than the sustained one', () => {
    const [burst, sustained] = buildThrottlerOptions(configFrom({}))
      .throttlers as { ttl: number; limit: number }[];

    expect(burst.ttl).toBeLessThan(sustained.ttl);
    expect(burst.limit).toBeLessThan(sustained.limit);
  });
});
