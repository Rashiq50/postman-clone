import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';

async function bootstrap() {
  // ⚠️ `bodyParser: false` hands body parsing to `configureApp`, which
  // installs a `json()` with the import size limit. Nest's built-in parser
  // caps at 100 kB and cannot be reconfigured after the fact — a real Postman
  // export passes that routinely, and the failure is a bare 413 with no
  // envelope. See the note in `configure-app.ts`.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get(ConfigService);

  configureApp(app);

  await app.listen(config.getOrThrow<number>('PORT'));
}
void bootstrap();
