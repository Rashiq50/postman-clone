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
});

export const envValidationOptions = {
  // Report every problem at once rather than one per restart.
  abortEarly: false,
  allowUnknown: true,
};
