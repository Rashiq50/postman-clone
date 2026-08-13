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
});

export const envValidationOptions = {
  // Report every problem at once rather than one per restart.
  abortEarly: false,
  allowUnknown: true,
};
