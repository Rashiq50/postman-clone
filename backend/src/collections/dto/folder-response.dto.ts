import type { Folder } from '@raven/contracts';
import { Expose, Transform, plainToInstance } from 'class-transformer';
import { FolderEntity } from '../entities/folder.entity';

const isoDate = ({ value }: { value: unknown }) =>
  value instanceof Date ? value.toISOString() : value;

export class FolderResponseDto implements Folder {
  @Expose()
  id: string;

  @Expose()
  collectionId: string;

  @Expose()
  parentFolderId: string | null;

  @Expose()
  name: string;

  @Expose()
  position: number;

  @Expose()
  @Transform(isoDate)
  createdAt: string;

  @Expose()
  @Transform(isoDate)
  updatedAt: string;

  static from(folder: FolderEntity): FolderResponseDto {
    return plainToInstance(FolderResponseDto, folder, {
      excludeExtraneousValues: true,
    });
  }

  static fromMany(folders: FolderEntity[]): FolderResponseDto[] {
    return folders.map((folder) => FolderResponseDto.from(folder));
  }
}
