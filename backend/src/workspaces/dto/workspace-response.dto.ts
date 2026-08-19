import type { Workspace, WorkspaceRole } from '@postman-clone/contracts';
import { Expose, Transform, plainToInstance } from 'class-transformer';
import type { WorkspaceWithRole } from '../workspaces.service';

const isoDate = ({ value }: { value: unknown }) =>
  value instanceof Date ? value.toISOString() : value;

export class WorkspaceResponseDto implements Workspace {
  @Expose()
  id: string;

  /** Always null in this slice — the organization seam. */
  @Expose()
  organizationId: string | null;

  @Expose()
  ownerUserId: string;

  @Expose()
  name: string;

  @Expose()
  isPersonal: boolean;

  /**
   * The **caller's** role, joined in by `WorkspacesService`, not a column on
   * `workspaces`. It travels here so the UI can disable what the caller cannot
   * do without asking a second time.
   */
  @Expose()
  role: WorkspaceRole;

  @Expose()
  @Transform(isoDate)
  createdAt: string;

  @Expose()
  @Transform(isoDate)
  updatedAt: string;

  static from(workspace: WorkspaceWithRole): WorkspaceResponseDto {
    return plainToInstance(WorkspaceResponseDto, workspace, {
      excludeExtraneousValues: true,
    });
  }

  static fromMany(workspaces: WorkspaceWithRole[]): WorkspaceResponseDto[] {
    return workspaces.map((workspace) => WorkspaceResponseDto.from(workspace));
  }
}
