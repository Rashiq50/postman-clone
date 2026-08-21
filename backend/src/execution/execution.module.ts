import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlingModule } from '../common/throttling/throttling.module';
import { RequestEntity } from '../requests/entities/request.entity';
import { RequestExecutionEntity } from './entities/request-execution.entity';
import { ExecutionController } from './execution.controller';
import { ExecutionService } from './execution.service';
import { ExecutionsController } from './executions.controller';
import { ExecutionsService } from './executions.service';
import { SendThrottlerGuard } from './send-throttler.guard';
import { SEND_OPTIONS, buildSendOptions } from './send-options';

/**
 * Sending, and the record of having sent.
 *
 * ⚠️ It imports `ThrottlingModule` rather than calling
 * `ThrottlerModule.forRootAsync` itself — a second registration would create a
 * second, independent storage and quietly double every configured limit.
 *
 * It imports **no** `WorkspacesModule`. Authorization travels inside each
 * statement via `workspace-scope.ts`'s fragments, exactly as in every other
 * feature here, and the environment lookup reaches `environments` in raw SQL
 * for the same reason `RequestsService.assertFolderInCollection` reaches
 * `folders` that way. **Nothing imports `WorkspacesModule`. Keep it that way.**
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([RequestExecutionEntity, RequestEntity]),
    ThrottlingModule,
  ],
  controllers: [ExecutionController, ExecutionsController],
  providers: [
    ExecutionService,
    ExecutionsService,
    // Per-route with `@UseGuards`, never a global `APP_GUARD` — the same rule
    // `ApiThrottlerGuard` follows.
    SendThrottlerGuard,
    {
      // ⚠️ Every `SEND_*` knob resolves through this one provider so that tests
      // can override **it** rather than `process.env`, which
      // `ConfigModule.forRoot()` has already read and validated by the time a
      // spec runs. See `send-options.ts`.
      provide: SEND_OPTIONS,
      inject: [ConfigService],
      useFactory: buildSendOptions,
    },
  ],
})
export class ExecutionModule {}
