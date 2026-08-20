import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import {
  clearRefreshCookie,
  readRefreshCookie,
  refreshCookieOptions,
  setRefreshCookie,
} from './refresh-cookie';

const COOKIE_NAME = 'pc_refresh_token';

function configFor(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    AUTH_COOKIE_NAME: COOKIE_NAME,
    COOKIE_SECURE: false,
    COOKIE_SAME_SITE: 'lax',
    COOKIE_DOMAIN: '',
    ...overrides,
  };

  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService;
}

function fakeResponse() {
  const cookie = jest.fn();
  const clearCookie = jest.fn();
  return {
    res: { cookie, clearCookie } as unknown as Response,
    cookie,
    clearCookie,
  };
}

describe('refresh cookie', () => {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  /**
   * The reason this file exists. `res.clearCookie` only clears a cookie whose
   * name, path and domain match the one that was set, so a single mismatched
   * option means logout silently does nothing: the server answers 204, the
   * browser keeps the cookie, and the next refresh succeeds as if nothing
   * happened. Nobody notices until a revoked device keeps working.
   */
  it('sets and clears with identical options apart from maxAge', () => {
    const config = configFor({ COOKIE_SECURE: true, COOKIE_DOMAIN: '' });

    const set = fakeResponse();
    setRefreshCookie(set.res, config, 'raw-token', expiresAt);
    const [setName, , setOptions] = set.cookie.mock.calls[0] as [
      string,
      string,
      CookieOptions,
    ];

    const cleared = fakeResponse();
    clearRefreshCookie(cleared.res, config);
    const [clearName, clearOptions] = cleared.clearCookie.mock.calls[0] as [
      string,
      CookieOptions,
    ];

    expect(clearName).toBe(setName);

    const { maxAge, ...setWithoutMaxAge } = setOptions;
    expect(maxAge).toEqual(expect.any(Number));
    expect(clearOptions).toEqual(setWithoutMaxAge);
    expect(clearOptions).not.toHaveProperty('maxAge');
  });

  it('is httpOnly unconditionally', () => {
    // No client-side code has any reason to read this value, and this is what
    // keeps an XSS from walking off with a 30-day credential.
    for (const overrides of [
      {},
      { COOKIE_SECURE: true },
      { COOKIE_SAME_SITE: 'none', COOKIE_SECURE: true },
      { COOKIE_DOMAIN: 'example.com' },
    ]) {
      expect(refreshCookieOptions(configFor(overrides)).httpOnly).toBe(true);
    }
  });

  it('scopes the cookie to the auth routes, built from the API constants', () => {
    // Keeps the long-lived credential off the resource routes: out of their
    // access logs and out of the blast radius of a bug on a hot path.
    expect(refreshCookieOptions(configFor()).path).toBe('/api/v1/auth');
  });

  it('carries the configured secure and sameSite attributes', () => {
    const options = refreshCookieOptions(
      configFor({ COOKIE_SECURE: true, COOKIE_SAME_SITE: 'strict' }),
    );

    expect(options.secure).toBe(true);
    expect(options.sameSite).toBe('strict');
  });

  it('omits the domain entirely when none is configured', () => {
    // An empty string must not become `Domain=`, or the cookie would not match
    // on clear — the exact asymmetry this file exists to prevent.
    expect(refreshCookieOptions(configFor()).domain).toBeUndefined();
    expect(
      refreshCookieOptions(configFor({ COOKIE_DOMAIN: 'example.com' })).domain,
    ).toBe('example.com');
  });

  it('derives maxAge from the session’s absolute expiry', () => {
    const { res, cookie } = fakeResponse();

    setRefreshCookie(res, configFor(), 'raw-token', expiresAt);

    const [, value, options] = cookie.mock.calls[0] as [
      string,
      string,
      CookieOptions,
    ];
    expect(value).toBe('raw-token');
    // The cookie dies with the session rather than outliving it.
    expect(options.maxAge).toBeLessThanOrEqual(
      expiresAt.getTime() - Date.now(),
    );
    expect(options.maxAge).toBeGreaterThan(
      expiresAt.getTime() - Date.now() - 5_000,
    );
  });

  it('never emits a negative maxAge for an already-expired session', () => {
    const { res, cookie } = fakeResponse();

    setRefreshCookie(
      res,
      configFor(),
      'raw-token',
      new Date(Date.now() - 1000),
    );

    const [, , options] = cookie.mock.calls[0] as [
      string,
      string,
      CookieOptions,
    ];
    expect(options.maxAge).toBe(0);
  });

  describe('readRefreshCookie', () => {
    it('reads the configured cookie name off the parsed request', () => {
      const req = {
        cookies: { [COOKIE_NAME]: 'raw-token' },
      } as unknown as Request;

      expect(readRefreshCookie(req, configFor())).toBe('raw-token');
    });

    it('is undefined when the cookie is absent or unparsed', () => {
      expect(
        readRefreshCookie({ cookies: {} } as unknown as Request, configFor()),
      ).toBeUndefined();
      expect(
        readRefreshCookie({} as unknown as Request, configFor()),
      ).toBeUndefined();
    });
  });
});
