import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import { API_PREFIX, API_VERSION, IMPORT_MAX_BYTES } from '@raven/contracts';
import { validationExceptionFactory } from './common/errors/validation-exception.factory';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/** Shared bootstrap used by main.ts and e2e tests so routes match production. */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);

  /*
   * ⚠️ **The body parser is installed here, not by Nest.** `main.ts` creates
   * the app with `bodyParser: false` precisely so this limit governs: Nest's
   * built-in parser is capped at 100 kB, which a real Postman export exceeds
   * routinely, and there is no way to raise it after the fact.
   *
   * The limit is `IMPORT_MAX_BYTES` — the same constant the client checks
   * `File.size` against before it even reads the file, so an oversize pick
   * fails instantly and locally, and this is the enforcement rather than the
   * first line of feedback.
   *
   * ⚠️ An e2e app built *without* `{ bodyParser: false }` keeps Nest's own
   * 100 kB parser and never reaches these lines — Nest's runs first and wins.
   * Only `import.e2e-spec.ts` opts out, which is why it is the only suite that
   * can assert on the real limit; the asymmetry is noted there too.
   */
  app.use(json({ limit: IMPORT_MAX_BYTES }));
  app.use(urlencoded({ extended: true, limit: IMPORT_MAX_BYTES }));

  // No signing secret: the refresh token is 256 bits of entropy checked
  // against a server-side hash, so a signature would add nothing an attacker
  // could not already produce by simply not having the token.
  app.use(cookieParser());

  app.setGlobalPrefix(API_PREFIX);

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: API_VERSION,
  });

  // `credentials: true` is required for the refresh cookie: without the
  // matching Access-Control-Allow-Credentials header the browser discards the
  // whole response of any request sent with `credentials: 'include'`, which is
  // every request the client makes. It also forces a concrete origin — a
  // wildcard is illegal alongside credentials, which CORS_ORIGIN already is.
  app.enableCors({
    origin: config.getOrThrow<string>('CORS_ORIGIN'),
    credentials: true,
    // `retry-after` alongside the request id: a cross-origin client cannot
    // read either header unless it is named here, and a 429 whose backoff
    // hint is invisible to the browser is a 429 the client has to guess at.
    exposedHeaders: ['x-request-id', 'retry-after'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
}
