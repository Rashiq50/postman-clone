import { HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiErrorCode } from '@postman-clone/contracts';
import type { ThrottlerLimitDetail, ThrottlerStorage } from '@nestjs/throttler';
import type { ExecutionContext } from '@nestjs/common';
import { ApiException } from '../errors/api.exception';
import { ApiThrottlerGuard } from './api-throttler.guard';

/**
 * The guard's inherited counting logic is the library's problem. What is ours
 * — and what a `429` is worthless without — is that the refusal comes out in
 * this API's envelope with the `RATE_LIMITED` code a client branches on, and
 * that the bucket is keyed by caller rather than globally.
 */
describe('ApiThrottlerGuard', () => {
  /** The protected surface under test, exposed without an `any` cast. */
  interface Internals {
    getTracker(req: Record<string, unknown>): Promise<string>;
    throwThrottlingException(
      context: ExecutionContext,
      detail: ThrottlerLimitDetail,
    ): Promise<void>;
  }

  const storage = {
    increment: jest.fn(),
  } as unknown as ThrottlerStorage;

  const guard = () =>
    new ApiThrottlerGuard(
      { throttlers: [] },
      storage,
      new Reflector(),
    ) as unknown as Internals;

  const detail = (timeToExpire: number): ThrottlerLimitDetail => ({
    ttl: 60000,
    limit: 5,
    key: 'key',
    tracker: '127.0.0.1',
    totalHits: 6,
    timeToExpire,
    isBlocked: true,
    timeToBlockExpire: timeToExpire,
  });

  /** Just enough of an `ExecutionContext` to reach the response headers. */
  let header: jest.Mock;
  let context: ExecutionContext;

  beforeEach(() => {
    header = jest.fn();
    context = {
      switchToHttp: () => ({ getResponse: () => ({ header }) }),
    } as unknown as ExecutionContext;
  });

  it('refuses with 429 RATE_LIMITED in the API envelope', async () => {
    await expect(
      guard().throwThrottlingException(context, detail(30)),
    ).rejects.toBeInstanceOf(ApiException);

    await guard()
      .throwThrottlingException(context, detail(30))
      .catch((error: ApiException) => {
        expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect(error.payload.code).toBe(ApiErrorCode.RATE_LIMITED);
        expect(error.payload.message).toContain('30 seconds');
      });
  });

  // A "try again in 0 seconds" reads as broken, and a sub-second remainder
  // rounds to it.
  it('never tells the caller to retry in zero seconds', async () => {
    await guard()
      .throwThrottlingException(context, detail(0.4))
      .catch((error: ApiException) => {
        expect(error.payload.message).toContain('1 second.');
      });
  });

  /**
   * The message must not name the window or the limit: that is a pacing hint
   * for whatever just hit it.
   */
  it('does not disclose the limit or the window', async () => {
    await guard()
      .throwThrottlingException(context, detail(30))
      .catch((error: ApiException) => {
        expect(error.payload.message).not.toContain('5');
        expect(error.payload.message).not.toContain('60');
      });
  });

  /**
   * The base guard writes `Retry-After-burst` for any window not named
   * `default`, which no client looks for. Whichever window fired, the plain
   * header has to carry the answer.
   */
  it('sets the standard Retry-After header', async () => {
    await guard()
      .throwThrottlingException(context, detail(30))
      .catch(() => undefined);

    expect(header).toHaveBeenCalledWith('Retry-After', '30');
  });

  it('buckets by caller address', async () => {
    await expect(guard().getTracker({ ip: '203.0.113.9' })).resolves.toBe(
      '203.0.113.9',
    );
  });

  // Better one shared bucket than a crash on a request with no address.
  it('falls back to a single bucket when the address is missing', async () => {
    await expect(guard().getTracker({})).resolves.toBe('unknown');
  });
});
