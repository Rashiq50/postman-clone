import type { EnvironmentVariable } from '@raven/contracts';
import {
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
import { WorkspaceEntity } from '../../workspaces/entities/workspace.entity';

/**
 * A named set of variables, scoped to a workspace.
 *
 * The table and its CRUD exist so the domain model is complete; **no
 * environment UI ships in this slice**, because without `{{var}}`
 * interpolation an environment editor is a form with no observable effect.
 */
@Entity('environments')
@Index('IDX_environments_workspaceId_position', ['workspace', 'position'])
export class EnvironmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'workspaceId',
    foreignKeyConstraintName: 'FK_environments_workspaceId',
  })
  workspace: WorkspaceEntity;

  @RelationId((environment: EnvironmentEntity) => environment.workspace)
  workspaceId: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  /** ⚠️ Values are stored and returned in plaintext. See the README. */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  variables: EnvironmentVariable[];

  @Column({ type: 'integer' })
  position: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
