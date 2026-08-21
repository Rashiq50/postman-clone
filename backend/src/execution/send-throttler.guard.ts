import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ApiThrottlerGuard } from '../common/throttling/api-throttler.guard';
import type { AuthenticatedUser } from '../auth/authenticated-user';

/**
 * `ApiThrottlerGuard`, keyed on the **user** rather than the IP.
 *
 * Every caller of `POST /requests/:id/send` is authenticated — the route sits
 * behind the global `JwtAuthGuard` — so a user id is always available and is
 * the honest unit of a send budget.
 *
 * ⚠️ Per-IP would be actively wrong here, not merely less precise: `req.ip` is
 * the *proxy's* address because `main.ts` does not enable Express's
 * `trust proxy`, so every user in the install would share one bucket and the
 * first busy person would rate-limit everybody else. That caveat is a
 * degradation for register (which has no user id to key on); here there is a
 * better key, so it is used.
 */
@Injectable()
export class SendThrottlerGuard extends ApiThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as Request & { user?: AuthenticatedUser };
    // The IP fallback is unreachable behind the global guard; it exists so a
    // future `@Public()` route cannot accidentally throttle on `undefined`.
    return Promise.resolve(request.user?.userId ?? request.ip ?? 'unknown');
  }
}
