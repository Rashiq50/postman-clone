import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class HealthService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /** Throws when the database is unreachable. */
  async pingDatabase(): Promise<void> {
    await this.dataSource.query('SELECT 1');
  }
}
