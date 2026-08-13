import 'reflect-metadata';
import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../config/database.config';

// The CLI runs outside Nest, so nothing has loaded .env for us yet.
loadEnv();

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required environment variable "${name}". ` +
        'Copy backend/.env.example to backend/.env and fill it in.',
    );
  }
  return value;
}

/**
 * Standalone DataSource for the TypeORM CLI (`yarn migration:generate`, etc).
 * The Nest app builds its options from ConfigService instead, but both go
 * through buildDataSourceOptions so they cannot disagree.
 */
export default new DataSource({
  ...buildDataSourceOptions({
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 5432),
    username: required('DB_USERNAME'),
    // May legitimately be empty, so it is not `required()`.
    password: process.env.DB_PASSWORD ?? '',
    database: required('DB_NAME'),
  }),
  // The CLI reads TypeScript sources directly via ts-node.
  entities: [join(__dirname, '..', '**', '*.entity.ts')],
  migrations: [join(__dirname, 'migrations', '*.ts')],
});
