import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../src/configure-app';
import { AppModule } from '../src/app.module';

describe('Health and default protection (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns ok without touching the database', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('GET /api/v1/ready returns ok when the database is reachable', () => {
    return request(app.getHttpServer())
      .get('/api/v1/ready')
      .expect(200)
      .expect({ status: 'ok', checks: { database: 'up' } });
  });

  // The global guard is the whole point of the `@Public()` markers above: these
  // two assertions fail if someone removes it, and the health tests fail if
  // someone forgets the marker on a route that probes must reach.
  it('rejects an unauthenticated request to a normal route', () => {
    return request(app.getHttpServer()).get('/api/v1/workspaces').expect(401);
  });

  it('leaves login reachable without a token', () => {
    return (
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'wrong-password' })
        // 401 for bad credentials — not for a missing token, which would be the
        // symptom of login itself having become protected.
        .expect(401)
        .expect((res) => {
          expect(res.body.error.message).toBe('Invalid credentials');
        })
    );
  });
});
