import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Rejects a state-changing public auth request that carries a foreign `Origin`.
 *
 * Why it exists: `POST /auth/refresh` and `POST /auth/logout` have to be
 * `@Public()` — the access token is expired by definition at that point — so
 * their only credential is a cookie the browser attaches automatically. That is
 * the textbook CSRF shape.
 *
 * The realistic damage is bounded: CORS allows exactly one origin, so an
 * attacker cannot *read* the response, and forcing a rotation is denial of
 * service rather than theft. `SameSite=Lax` already closes it, because these
 * routes are POST-only and so unreachable by top-level navigation. (`Strict`
 * buys nothing extra here — it only additionally blocks top-level GET, and
 * there is no GET — while costing graceful behaviour for a future OAuth
 * callback or magic link.)
 *
 * This guard is the belt to that braces, for ~10 lines: it means the feature's
 * security does not silently depend on `COOKIE_SAME_SITE` never being set to
 * `none` for some future cross-site deployment.
 *
 * A missing `Origin` is allowed: non-browser clients (curl, the e2e suite,
 * mobile apps) legitimately send none, and CSRF is a browser-only attack. Do
 * **not** substitute "requires `Content-Type: application/json`" for this — a
 * cross-site form can POST `x-www-form-urlencoded`, which is a simple request
 * and is never preflighted.
 */
@Injectable()
export class OriginCheckGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.header('origin');

    if (!origin) {
      return true;
    }

    if (origin !== this.configService.getOrThrow<string>('CORS_ORIGIN')) {
      throw new ForbiddenException('Origin not allowed');
    }

    return true;
  }
}
