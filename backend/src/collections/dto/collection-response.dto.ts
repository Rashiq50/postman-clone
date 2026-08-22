import type {
  Collection,
  CollectionAuth,
  KeyValueEntry,
} from '@raven/contracts';
import { Expose, Transform, plainToInstance } from 'class-transformer';
import { CollectionEntity } from '../entities/collection.entity';

const isoDate = ({ value }: { value: unknown }) =>
  value instanceof Date ? value.toISOString() : value;

export class CollectionResponseDto implements Collection {
  @Expose()
  id: string;

  @Expose()
  workspaceId: string;

  @Expose()
  name: string;

  @Expose()
  description: string | null;

  @Expose()
  position: number;

  /** ⚠️ Plaintext, exactly like the request's. See the README. */
  @Expose()
  auth: CollectionAuth;

  @Expose()
  variables: KeyValueEntry[];

  @Expose()
  @Transform(isoDate)
  createdAt: string;

  @Expose()
  @Transform(isoDate)
  updatedAt: string;

  static from(collection: CollectionEntity): CollectionResponseDto {
    return plainToInstance(CollectionResponseDto, collection, {
      excludeExtraneousValues: true,
    });
  }

  static fromMany(collections: CollectionEntity[]): CollectionResponseDto[] {
    return collections.map((collection) =>
      CollectionResponseDto.from(collection),
    );
  }
}
