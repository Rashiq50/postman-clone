import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { buildThrottlerOptions } from './throttler.config';

/**
 * The one place `ThrottlerModule.forRootAsync` is called.
 *
 * ⚠️ **Registering `forRootAsync` twice gives two independent storages**, and
 * therefore two independent counters over the same windows — a limit that
 * silently allows twice what it says. It lived inside `AuthModule` while
 * `POST /auth/register` was the only throttled route; `ExecutionModule` needs
 * it too, so it moved here and is re-exported rather than being registered a
 * second time.
 *
 * It is still **not** an `APP_GUARD`. The windows are applied per-route with
 * `@UseGuards`, because a global throttler would put every resource endpoint on
 * one shared budget — behind a proxy (see `ApiThrottlerGuard.getTracker`) that
 * is a single bucket for the entire user base, which is a denial of service
 * against yourself rather than a defence.
 *
 * Storage is the default in-memory counter, so every limit is **per process**:
 * two instances behind a load balancer allow twice the configured rate. A
 * shared store (`@nestjs/throttler-storage-redis`) is the fix when this runs on
 * more than one node.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: buildThrottlerOptions,
    }),
  ],
  exports: [ThrottlerModule],
})
export class ThrottlingModule {}
