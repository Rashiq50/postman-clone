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

@Entity('collections')
@Index('IDX_collections_workspaceId_position', ['workspace', 'position'])
export class CollectionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'workspaceId',
    foreignKeyConstraintName: 'FK_collections_workspaceId',
  })
  workspace: WorkspaceEntity;

  @RelationId((collection: CollectionEntity) => collection.workspace)
  workspaceId: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /**
   * No `default` here, matching the migration. The service always computes
   * MAX + POSITION_GAP; a default would be a value the ordering logic never
   * produces, so its only possible effect is to mask a path that forgot to.
   */
  @Column({ type: 'integer' })
  position: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
