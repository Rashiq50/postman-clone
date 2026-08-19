import { HttpStatus, Injectable, type ExecutionContext } from '@nestjs/common';
import { ApiErrorCode } from '@postman-clone/contracts';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ApiException } from '../errors/api.exception';

/**
 * `ThrottlerGuard` with this API's error envelope.
 *
 * The base guard throws Nest's `ThrottlerException`, which `AllExceptionsFilter`
 * would render as `{ code: "RATE_LIMITED", message: "ThrottlerException: Too
 * Many Requests" }` — the right code, wrapped around a message naming a class
 * the client has never heard of. Overriding the throw is what makes
 * `RATE_LIMITED` a code with a usable message behind it rather than one that
 * merely exists in the enum.
 *
 * It also normalises `Retry-After`. The base guard suffixes that header with
 * the throttler's name for every window except one called `default` — a
 * `Retry-After-burst` no HTTP client on earth looks for. The plain header is
 * set here instead, so whichever window fired, the answer arrives somewhere a
 * client can actually find it.
 */
@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  /**
   * The bucket key.
   *
   * ⚠️ `req.ip` is the *proxy's* address behind a load balancer, because
   * `main.ts` does not enable Express's `trust proxy` — the same caveat the
   * session list carries. Behind a proxy every caller therefore shares one
   * bucket and this limit degrades into a global one, which is a denial of
   * service against your own signups rather than a defence. Enabling
   * `trust proxy` with the deployment's real hop count is a prerequisite for
   * running this in production; until then it is a development-grade control.
   */
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as Request;
    return Promise.resolve(request.ip ?? 'unknown');
  }

  // Returns a rejected promise rather than throwing synchronously, matching
  // the base class and every caller that awaits it.
  protected throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const seconds = Math.max(1, Math.ceil(detail.timeToExpire));

    // Whichever named window tripped, the standard header says the same thing.
    context
      .switchToHttp()
      .getResponse<Response>()
      .header('Retry-After', String(seconds));

    return Promise.reject(
      new ApiException(HttpStatus.TOO_MANY_REQUESTS, {
        code: ApiErrorCode.RATE_LIMITED,
        // Deliberately vague about *which* limit was hit and how big it is:
        // naming the window tells a script exactly how to pace itself.
        message: `Too many attempts. Try again in ${seconds} second${
          seconds === 1 ? '' : 's'
        }.`,
      }),
    );
  }
}
