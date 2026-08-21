import { WorkspaceRole } from '@postman-clone/contracts';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  RelationId,
  UpdateDateColumn,
} from 'typeorm';
import { EnvironmentEntity } from '../../environments/entities/environment.entity';
import { UserEntity } from '../../users/entities/user.entity';
import { WorkspaceEntity } from './workspace.entity';

/** One user's role in one workspace. The row every authorization query joins. */
@Entity('workspace_members')
@Check(
  'CHK_workspace_members_role',
  `"role" IN ('OWNER','ADMIN','EDITOR','VIEWER')`,
)
@Index('UQ_workspace_members_workspace_user', ['workspace', 'user'], {
  unique: true,
})
export class WorkspaceMemberEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => WorkspaceEntity, (workspace) => workspace.members, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({
    name: 'workspaceId',
    foreignKeyConstraintName: 'FK_workspace_members_workspaceId',
  })
  workspace: WorkspaceEntity;

  @RelationId((member: WorkspaceMemberEntity) => member.workspace)
  workspaceId: string;

  @Index('IDX_workspace_members_userId')
  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'userId',
    foreignKeyConstraintName: 'FK_workspace_members_userId',
  })
  user: UserEntity;

  @RelationId((member: WorkspaceMemberEntity) => member.user)
  userId: string;

  /**
   * `varchar`, not `type: 'enum'`. An enum column makes TypeORM want to create
   * a Postgres enum type the migration never created, and every
   * `migration:generate` from then on emits churn trying to add it. The
   * database side is a CHECK constraint; the const object in contracts is the
   * source of truth.
   */
  @Column({ type: 'varchar', length: 16 })
  role: WorkspaceRole;

  /**
   * The environment this member has selected in this workspace.
   *
   * A property of the person, not of the workspace — the same kind of field as
   * `role` above, which is why both are joined onto `Workspace` on the wire.
   * It is per member rather than per device, deliberately the opposite of the
   * theme preference: an environment selects *which server you are about to
   * hit*, and that should follow someone between machines.
   *
   * ⚠️ **`SET NULL`, never `CASCADE`.** Cascading here deletes the *membership
   * row* when an environment is deleted — a user evicted from a workspace
   * because someone tidied up an environment, with no invite endpoint to
   * repair it. See the migration.
   */
  @ManyToOne(() => EnvironmentEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'activeEnvironmentId',
    foreignKeyConstraintName: 'FK_workspace_members_activeEnvironmentId',
  })
  activeEnvironment: EnvironmentEntity | null;

  @RelationId((member: WorkspaceMemberEntity) => member.activeEnvironment)
  activeEnvironmentId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
