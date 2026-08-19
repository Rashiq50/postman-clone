import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { API_PREFIX, API_VERSION } from '@postman-clone/contracts';
import { validationExceptionFactory } from './common/errors/validation-exception.factory';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/** Shared bootstrap used by main.ts and e2e tests so routes match production. */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);

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
