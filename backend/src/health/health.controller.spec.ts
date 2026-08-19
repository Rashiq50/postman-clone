import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

function mockResponse(): Response & {
  status: jest.Mock;
  json: jest.Mock;
} {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
  };
}

describe('HealthController', () => {
  let controller: HealthController;
  let healthService: { pingDatabase: jest.Mock };

  beforeEach(async () => {
    healthService = { pingDatabase: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: healthService }],
    }).compile();

    controller = module.get(HealthController);
  });

  describe('health', () => {
    it('returns ok without calling external dependencies', () => {
      expect(controller.health()).toEqual({ status: 'ok' });
      expect(healthService.pingDatabase).not.toHaveBeenCalled();
    });
  });

  describe('ready', () => {
    it('returns ok when the database responds', async () => {
      healthService.pingDatabase.mockResolvedValue(undefined);
      const res = mockResponse();

      await controller.ready(res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        status: 'ok',
        checks: { database: 'up' },
      });
    });

    it('returns 503 when the database is unreachable', async () => {
      healthService.pingDatabase.mockRejectedValue(
        new Error('connection refused'),
      );
      const res = mockResponse();

      await controller.ready(res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        status: 'error',
        checks: { database: 'down' },
      });
    });
  });
});
