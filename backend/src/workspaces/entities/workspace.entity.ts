import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  RelationId,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity';
import { WorkspaceMemberEntity } from './workspace-member.entity';

/**
 * The tenancy boundary. Everything a user can see hangs off one of these.
 *
 * `ownerUserId` and the OWNER row in `workspace_members` are two views of one
 * fact. They are written together by `provisionPersonalWorkspace` and
 * backfilled together by the migration — not enforced by a constraint (that
 * would need a trigger), but by there being exactly one code path that writes
 * either of them.
 */
@Entity('workspaces')
// One personal workspace per user, as a partial unique index. Declared here as
// well as in the migration so `migration:generate` does not propose to drop it.
@Index('UQ_workspaces_personal_owner', ['owner'], {
  unique: true,
  where: '"isPersonal"',
})
export class WorkspaceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * The organization seam. Always NULL today: organizations are deferred, and
   * this column exists now so attaching them later is one ALTER TABLE rather
   * than a column addition, a backfill, and a rewrite of every scoping clause.
   *
   * A plain column, not a relation — there is no `organizations` table to
   * point at, and the migration deliberately creates no foreign key.
   */
  @Index('IDX_workspaces_organizationId', {
    where: '"organizationId" IS NOT NULL',
  })
  @Column({ type: 'uuid', nullable: true })
  organizationId: string | null;

  @Index('IDX_workspaces_ownerUserId')
  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'ownerUserId',
    foreignKeyConstraintName: 'FK_workspaces_ownerUserId',
  })
  owner: UserEntity;

  @RelationId((workspace: WorkspaceEntity) => workspace.owner)
  ownerUserId: string;

  @OneToMany(() => WorkspaceMemberEntity, (member) => member.workspace)
  members: WorkspaceMemberEntity[];

  @Column({ type: 'varchar', length: 120 })
  name: string;

  /**
   * Exactly one per user, enforced by the partial unique index
   * `UQ_workspaces_personal_owner`. A personal workspace cannot be deleted —
   * a user who deleted their only one would land in an app with no valid route.
   */
  @Column({ type: 'boolean', default: false })
  isPersonal: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
