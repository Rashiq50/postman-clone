import * as Joi from 'joi';

/**
 * Validated at boot. A missing or malformed variable stops the process with a
 * readable message instead of surfacing as `undefined` deep inside a request —
 * which, for a signing secret, is an auth bypass rather than a crash.
 *
 * Add every new variable here. If it is not in this schema, `whitelist` drops
 * it and `ConfigService` will never see it.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  CORS_ORIGIN: Joi.string().uri().default('http://localhost:5173'),

  DB_HOST: Joi.string().hostname().required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.string().required(),
  // Allowed to be empty (trust auth), but must be present and deliberate.
  DB_PASSWORD: Joi.string().allow('').required(),
  DB_NAME: Joi.string().required(),
  // 32 bytes of entropy is the minimum that makes HS256 signatures worth
  // trusting; a short human-chosen secret is brute-forceable offline.
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  // `ms` duration. Access tokens are not revocable before they expire, so keep
  // this short and let the refresh token carry the long-lived session.
  JWT_ACCESS_EXPIRES_IN: Joi.string()
    .pattern(/^\d+(ms|s|m|h|d)$/)
    .default('15m'),
  JWT_ISSUER: Joi.string().default('postman-clone'),
  JWT_AUDIENCE: Joi.string().default('postman-clone-api'),
  // Same `ms` duration grammar as JWT_ACCESS_EXPIRES_IN. The pattern is not
  // decoration: `parseDuration` throws on anything else, and without it a typo
  // here would take the process down at boot rather than being named as the
  // offending variable.
  REFRESH_TOKEN_EXPIRES_IN: Joi.string()
    .pattern(/^\d+(ms|s|m|h|d)$/)
    .required(),
  AUTH_COOKIE_NAME: Joi.string().required(),

  // Cookie attributes. `secure` defaults by environment so a developer on
  // http://localhost is not handed a cookie the browser then refuses to send
  // back, while production defaults to the safe value.
  COOKIE_SECURE: Joi.boolean().when('NODE_ENV', {
    is: 'production',
    then: Joi.boolean().default(true),
    otherwise: Joi.boolean().default(false),
  }),
  COOKIE_SAME_SITE: Joi.string().valid('lax', 'strict', 'none').default('lax'),
  // Empty means host-only, which is what a single-origin deployment wants.
  COOKIE_DOMAIN: Joi.string().hostname().allow('').default(''),
  // How long after a refresh token is first spent a replay still reads as two
  // tabs racing rather than theft. See `SessionsService.rotate`.
  REFRESH_ROTATION_GRACE_MS: Joi.number().integer().min(0).default(10000),
  // Concurrent live sessions per user; anything past the cap is revoked
  // oldest-by-last-activity on the next login. A developer legitimately has a
  // desktop app + browser + dev browser + private window + a second machine,
  // so this sits well above "a few": it bounds abuse rather than policing
  // normal use.
  MAX_SESSIONS_PER_USER: Joi.number().integer().min(1).default(10),

  // Rate limiting for `POST /auth/register`, keyed by IP. Two windows applied
  // together: a burst bound for a spike and a sustained bound for the total.
  // See `common/throttling/throttler.config.ts` for why one of each.
  THROTTLE_BURST_TTL_MS: Joi.number().integer().min(1000).default(60000),
  THROTTLE_BURST_LIMIT: Joi.number().integer().min(1).default(5),
  THROTTLE_SUSTAINED_TTL_MS: Joi.number().integer().min(1000).default(3600000),
  THROTTLE_SUSTAINED_LIMIT: Joi.number().integer().min(1).default(20),

  // Rate limiting for `POST /requests/:id/send`, keyed by **user id** rather
  // than IP: every caller here is authenticated, and `req.ip` is the proxy's
  // address. Its own budget, because the register windows above are sized for
  // a signup form and would make Send unusable.
  SEND_THROTTLE_BURST_TTL_MS: Joi.number().integer().min(1000).default(60000),
  SEND_THROTTLE_BURST_LIMIT: Joi.number().integer().min(1).default(30),
  SEND_THROTTLE_SUSTAINED_TTL_MS: Joi.number()
    .integer()
    .min(1000)
    .default(3600000),
  SEND_THROTTLE_SUSTAINED_LIMIT: Joi.number().integer().min(1).default(600),

  // ⚠️ Turns the SSRF address policy OFF, so a send can reach loopback, RFC1918
  // and the cloud metadata endpoint. Development only — it exists so a
  // developer can point the app at their own `localhost` API. DNS resolution
  // and connection pinning still happen; only the screening step is skipped.
  // The service logs a warning at boot when this is on, so nobody ships it by
  // accident.
  SEND_ALLOW_PRIVATE_NETWORK: Joi.boolean().default(false),
  SEND_CONNECT_TIMEOUT_MS: Joi.number().integer().min(1).default(5000),
  // One absolute deadline across every redirect hop. A per-hop timeout under a
  // 5-hop cap is a 5x timeout; this is also what bounds a slowloris response
  // body, which a connect timeout does not.
  SEND_TOTAL_TIMEOUT_MS: Joi.number().integer().min(1).default(30000),
  SEND_MAX_REDIRECTS: Joi.number().integer().min(0).default(5),
  // ⚠️ A cap on **decompressed** bytes. We ask for `identity`; if the target
  // compresses anyway, zlib's `maxOutputLength` is what keeps this real.
  SEND_MAX_RESPONSE_BYTES: Joi.number().integer().min(1).default(5242880),
  SEND_MAX_REQUEST_BODY_BYTES: Joi.number().integer().min(1).default(1048576),
  // Deliberately far lower than the live cap: stored bodies are the growth
  // driver for `request_executions` (this cap x the per-request cap x every
  // request in the install).
  SEND_MAX_STORED_BODY_BYTES: Joi.number().integer().min(1).default(262144),
  SEND_HISTORY_PER_REQUEST: Joi.number().integer().min(1).default(50),
  SEND_HISTORY_RETENTION_DAYS: Joi.number().integer().min(1).default(30),
})
  /**
   * `SameSite=None` without `Secure` is dropped outright by every current
   * browser, and the failure is invisible from the server: login returns 200,
   * the cookie never lands, and every refresh afterwards 401s. Name it at boot
   * instead.
   */
  .custom((value: Record<string, unknown>) => {
    if (value.COOKIE_SAME_SITE === 'none' && value.COOKIE_SECURE !== true) {
      throw new Error(
        'COOKIE_SAME_SITE=none requires COOKIE_SECURE=true; browsers silently drop such a cookie',
      );
    }
    return value;
  });

export const envValidationOptions = {
  // Report every problem at once rather than one per restart.
  abortEarly: false,
  allowUnknown: true,
};
