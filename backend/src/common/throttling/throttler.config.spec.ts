import { ConfigService } from '@nestjs/config';
import type { ValidationResult } from 'joi';
import { envValidationSchema } from '../../config/env.validation';
import {
  SKIP_DEFAULT_THROTTLERS,
  SKIP_SEND_THROTTLERS,
  buildThrottlerOptions,
} from './throttler.config';

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
      { name: 'sendBurst', ttl: 60000, limit: 30 },
      { name: 'sendSustained', ttl: 3600000, limit: 600 },
    ]);
  });

  it('builds Send its own pair of windows from its own variables', () => {
    // Separate budgets, one registration. Registering `forRootAsync` twice to
    // get two universes would give two independent storages, and therefore a
    // counter that silently allows double what it says.
    const options = buildThrottlerOptions(
      configFrom({
        SEND_THROTTLE_BURST_TTL_MS: '2000',
        SEND_THROTTLE_BURST_LIMIT: '11',
        SEND_THROTTLE_SUSTAINED_TTL_MS: '8000',
        SEND_THROTTLE_SUSTAINED_LIMIT: '99',
      }),
    );

    expect(options.throttlers).toEqual([
      { name: 'burst', ttl: 60000, limit: 5 },
      { name: 'sustained', ttl: 3600000, limit: 20 },
      { name: 'sendBurst', ttl: 2000, limit: 11 },
      { name: 'sendSustained', ttl: 8000, limit: 99 },
    ]);
  });

  it('names every window uniquely, since routes opt out of a pair by name', () => {
    const names = buildThrottlerOptions(configFrom({})).throttlers.map(
      (throttler) => throttler.name,
    );

    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(['burst', 'sustained', 'sendBurst', 'sendSustained']);
  });

  it('splits the windows between the two skip sets, covering each exactly once', () => {
    const names = buildThrottlerOptions(configFrom({})).throttlers.map(
      (throttler) => throttler.name,
    );

    // Every skipped name must be a window that actually exists, or the opt-out
    // silently does nothing and the route spends the wrong budget.
    for (const name of [
      ...Object.keys(SKIP_SEND_THROTTLERS),
      ...Object.keys(SKIP_DEFAULT_THROTTLERS),
    ]) {
      expect(names).toContain(name);
    }

    // And together they must cover every window exactly once: a window named
    // by neither would apply to both routes.
    expect(
      [
        ...Object.keys(SKIP_SEND_THROTTLERS),
        ...Object.keys(SKIP_DEFAULT_THROTTLERS),
      ].sort(),
    ).toEqual([...names].sort());
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
      { name: 'sendBurst', ttl: 60000, limit: 30 },
      { name: 'sendSustained', ttl: 3600000, limit: 600 },
    ]);
  });

  // A burst window that outlasts the sustained one is a misconfiguration the
  // two-window design cannot express; the ordering is what makes them a pair.
  it('keeps each burst window shorter and tighter than its sustained pair', () => {
    const [burst, sustained, sendBurst, sendSustained] = buildThrottlerOptions(
      configFrom({}),
    ).throttlers as { ttl: number; limit: number }[];

    expect(burst.ttl).toBeLessThan(sustained.ttl);
    expect(burst.limit).toBeLessThan(sustained.limit);
    expect(sendBurst.ttl).toBeLessThan(sendSustained.ttl);
    expect(sendBurst.limit).toBeLessThan(sendSustained.limit);
  });

  it('gives Send a far more generous budget than register', () => {
    // Send on register's budget — five a minute — is unusable; register on
    // Send's stops being a limit on an enumeration oracle.
    const [burst, , sendBurst] = buildThrottlerOptions(configFrom({}))
      .throttlers as { limit: number }[];

    expect(sendBurst.limit).toBeGreaterThan(burst.limit);
  });
});
