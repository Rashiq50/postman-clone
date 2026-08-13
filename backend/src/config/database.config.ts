import { join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';

export interface DatabaseEnv {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

/**
 * Single source of truth for connection options, shared by the Nest app and
 * the TypeORM CLI. If these two ever drift, migrations get generated against a
 * different schema than the one the app talks to.
 */
export function buildDataSourceOptions(env: DatabaseEnv): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.host,
    port: env.port,
    username: env.username,
    password: env.password,
    database: env.database,

    // Never true, in any environment. Schema changes go through migrations so
    // they are reviewable, ordered, and reversible; `synchronize` will happily
    // drop a column to match a renamed field.
    synchronize: false,

    // Run explicitly (`yarn migration:run`), not on boot, so a deploy that
    // fails to migrate fails visibly instead of half-starting.
    migrationsRun: false,
    migrations: [join(__dirname, '..', 'database', 'migrations', '*.js')],
  };
}
