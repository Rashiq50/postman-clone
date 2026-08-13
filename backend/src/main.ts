import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { API_PREFIX, API_VERSION } from '@postman-clone/contracts';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { validationExceptionFactory } from './common/errors/validation-exception.factory';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix(API_PREFIX);

  // URI versioning: /api/v1/tasks. A breaking change ships as v2 alongside v1
  // rather than by mutating an endpoint clients already depend on.
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: API_VERSION,
  });

  app.enableCors({
    origin: config.getOrThrow<string>('CORS_ORIGIN'),
    // So a browser client can read the id it needs to quote in a bug report.
    exposedHeaders: ['x-request-id'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  // Every failure leaves through here in the shape declared by the contract.
  app.useGlobalFilters(new AllExceptionsFilter());

  await app.listen(config.getOrThrow<number>('PORT'));
}
void bootstrap();
