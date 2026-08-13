import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildDataSourceOptions } from './config/database.config';
import {
  envValidationOptions,
  envValidationSchema,
} from './config/env.validation';
import { HealthModule } from './health/health.module';
import { TasksModule } from './tasks/tasks.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SessionsModule } from './sessions/sessions.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: envValidationOptions,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ...buildDataSourceOptions({
          host: config.getOrThrow<string>('DB_HOST'),
          port: config.getOrThrow<number>('DB_PORT'),
          username: config.getOrThrow<string>('DB_USERNAME'),
          password: config.getOrThrow<string>('DB_PASSWORD'),
          database: config.getOrThrow<string>('DB_NAME'),
        }),
        autoLoadEntities: true,
      }),
    }),
    HealthModule,
    TasksModule,
    AuthModule,
    UsersModule,
    SessionsModule,
  ],
})
export class AppModule {}
