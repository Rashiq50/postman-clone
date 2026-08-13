import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { API_VERSION } from '@postman-clone/contracts';
import type { Response } from 'express';
import { HealthService } from './health.service';

export interface HealthResponse {
  status: 'ok';
}

export interface ReadinessResponse {
  status: 'ok' | 'error';
  checks: {
    database: 'up' | 'down';
  };
}

/**
 * Infrastructure endpoints for load balancers and orchestrators.
 *
 * These intentionally use a simple JSON shape rather than the API error
 * envelope — probes only need a status code and a minimal body.
 */
@Controller({ version: API_VERSION })
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** Liveness: process is running. Does not touch external dependencies. */
  @Get('health')
  @HttpCode(HttpStatus.OK)
  health(): HealthResponse {
    return { status: 'ok' };
  }

  /** Readiness: process can serve traffic (database reachable). */
  @Get('ready')
  async ready(@Res() res: Response): Promise<void> {
    try {
      await this.healthService.pingDatabase();
      res.status(HttpStatus.OK).json({
        status: 'ok',
        checks: { database: 'up' },
      } satisfies ReadinessResponse);
    } catch {
      // Simple JSON for probes — not the API error envelope.
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        status: 'error',
        checks: { database: 'down' },
      } satisfies ReadinessResponse);
    }
  }
}
