import { ConfigService } from '@nestjs/config';
import { API_PREFIX, API_VERSION } from '@raven/contracts';
import type { CookieOptions, Request, Response } from 'express';

/**
 * Everything about the refresh cookie, in one file.
 *
 * These are plain exported functions rather than an `@Injectable()` on
 * purpose. `SessionsController` needs `clearRefreshCookie` too, and a provider
 * would force `SessionsModule → AuthModule` while `AuthModule` already imports
 * `SessionsModule` — a cycle. A plain import has no DI edge at all.
 *
 * The reason the file exists: `res.clearCookie` only clears a cookie whose
 * name, path and domain match the one that was set. A single mismatched
 * character and logout silently does nothing — the server reports 204, the
 * browser keeps the cookie, and the next refresh succeeds. Set and clear are
 * therefore built from the same function here, never written out twice.
 */

/**
 * Scoped to the auth routes rather than `/`, so the long-lived credential is
 * never attached to the resource routes: it stays out of their access logs and
 * out of the blast radius of a bug on a hot path.
 *
 * The trade-off is that this rules out the `__Host-` cookie prefix, which
 * requires `Path=/`. Accepted: `__Host-` defends against cookie shadowing from
 * untrusted sibling subdomains, which this deployment does not have. Do not
 * "fix" `AUTH_COOKIE_NAME` into a `__Host-` name — the browser would reject
 * the cookie outright and every refresh would fail.
 */
const REFRESH_COOKIE_PATH = `/${API_PREFIX}/v${API_VERSION}/auth`;

export function refreshCookieName(config: ConfigService): string {
  return config.getOrThrow<string>('AUTH_COOKIE_NAME');
}

/** The attributes shared by setting and clearing. `maxAge` is added only on set. */
export function refreshCookieOptions(config: ConfigService): CookieOptions {
  const domain = config.get<string>('COOKIE_DOMAIN');

  return {
    // Unconditional: no client-side code has any reason to read this value,
    // and this is what keeps an XSS from walking off with a 30-day credential.
    httpOnly: true,
    secure: config.get<boolean>('COOKIE_SECURE') ?? false,
    sameSite:
      config.get<'lax' | 'strict' | 'none'>('COOKIE_SAME_SITE') ?? 'lax',
    path: REFRESH_COOKIE_PATH,
    // An empty domain must become `undefined`, not '': Express would otherwise
    // emit `Domain=`, and the cookie would not match on clear.
    domain: domain ? domain : undefined,
  };
}

export function setRefreshCookie(
  res: Response,
  config: ConfigService,
  token: string,
  expiresAt: Date,
): void {
  res.cookie(refreshCookieName(config), token, {
    ...refreshCookieOptions(config),
    // Derived from the session's absolute expiry rather than the TTL, so the
    // cookie dies with the session it belongs to instead of outliving it.
    maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
  });
}

export function clearRefreshCookie(res: Response, config: ConfigService): void {
  // Spreads the identical options minus `maxAge`. Anything else here — a
  // hard-coded path, a forgotten domain — and logout stops working.
  res.clearCookie(refreshCookieName(config), refreshCookieOptions(config));
}

export function readRefreshCookie(
  req: Request,
  config: ConfigService,
): string | undefined {
  // `req.cookies` is populated by `cookieParser()` in configure-app.ts. It is
  // typed as `any` by @types/cookie-parser, hence the narrowing here.
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[refreshCookieName(config)];
}
