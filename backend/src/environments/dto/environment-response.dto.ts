import type {
  Environment,
  EnvironmentVariable,
} from '@raven/contracts';
import { Expose, Transform, plainToInstance } from 'class-transformer';
import { EnvironmentEntity } from '../entities/environment.entity';

const isoDate = ({ value }: { value: unknown }) =>
  value instanceof Date ? value.toISOString() : value;

/** ⚠️ `variables` goes out in plaintext, `secret` flag or not. See the README. */
export class EnvironmentResponseDto implements Environment {
  @Expose()
  id: string;

  @Expose()
  workspaceId: string;

  @Expose()
  name: string;

  @Expose()
  variables: EnvironmentVariable[];

  @Expose()
  position: number;

  @Expose()
  @Transform(isoDate)
  createdAt: string;

  @Expose()
  @Transform(isoDate)
  updatedAt: string;

  static from(environment: EnvironmentEntity): EnvironmentResponseDto {
    return plainToInstance(EnvironmentResponseDto, environment, {
      excludeExtraneousValues: true,
    });
  }

  static fromMany(environments: EnvironmentEntity[]): EnvironmentResponseDto[] {
    return environments.map((environment) =>
      EnvironmentResponseDto.from(environment),
    );
  }
}
