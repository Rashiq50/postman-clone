import type {
  Collection,
  Environment,
  ImportCollectionResult,
  ImportEnvironmentResult,
  ImportWarning,
} from '@raven/contracts';
import { Expose, plainToInstance } from 'class-transformer';
import { CollectionResponseDto } from '../../collections/dto/collection-response.dto';
import { CollectionEntity } from '../../collections/entities/collection.entity';
import { EnvironmentResponseDto } from '../../environments/dto/environment-response.dto';
import { EnvironmentEntity } from '../../environments/entities/environment.entity';

/**
 * ⚠️ The nested resource goes through its **own** response DTO, not through
 * this one's `excludeExtraneousValues` pass. `plainToInstance` does not
 * recursively apply a nested class's `@Expose()` rules without `@Type()`, so
 * embedding the entity directly would either leak entity-only fields or hand
 * back `Date` objects where the contract says ISO strings. Composing the
 * existing DTOs also means a new column on `collections` is exposed in exactly
 * one place.
 */
export class ImportCollectionResultDto implements ImportCollectionResult {
  @Expose()
  collection: Collection;

  @Expose()
  folderCount: number;

  @Expose()
  requestCount: number;

  @Expose()
  warnings: ImportWarning[];

  static from(result: {
    collection: CollectionEntity;
    folderCount: number;
    requestCount: number;
    warnings: ImportWarning[];
  }): ImportCollectionResultDto {
    return plainToInstance(
      ImportCollectionResultDto,
      {
        collection: CollectionResponseDto.from(result.collection),
        folderCount: result.folderCount,
        requestCount: result.requestCount,
        warnings: result.warnings,
      },
      { excludeExtraneousValues: true },
    );
  }
}

export class ImportEnvironmentResultDto implements ImportEnvironmentResult {
  @Expose()
  environment: Environment;

  @Expose()
  warnings: ImportWarning[];

  static from(result: {
    environment: EnvironmentEntity;
    warnings: ImportWarning[];
  }): ImportEnvironmentResultDto {
    return plainToInstance(
      ImportEnvironmentResultDto,
      {
        environment: EnvironmentResponseDto.from(result.environment),
        warnings: result.warnings,
      },
      { excludeExtraneousValues: true },
    );
  }
}
