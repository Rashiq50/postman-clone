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
import type { CollectionAuth, KeyValueEntry } from '@raven/contracts';
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
  /**
   * The auth a request's `auth: 'inherit'` will inherit from.
   *
   * ⚠️ Written by import and by `PATCH /collections/:id`; **not yet read by
   * Send** — `interpolate.ts` still resolves `inherit` to `none`. It is stored
   * because an import that dropped it would lose the credential for every
   * request under the collection at once.
   *
   * The default is spelled exactly as Postgres normalizes it — a space after
   * the colon, no `::jsonb` cast — for the reason recorded on
   * `RequestEntity.headers`. Getting the spelling wrong is not a runtime bug;
   * it makes `migration:generate` propose the same no-op ALTER COLUMN forever.
   *
   * ⚠️ Holds bearer tokens and passwords in plaintext, like the request's. See
   * the README.
   */
  @Column({ type: 'jsonb', default: () => `'{"type": "none"}'` })
  auth: CollectionAuth;

  /** Collection-scoped `{{variables}}`. Stored only — see `auth` above. */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  variables: KeyValueEntry[];

  @Column({ type: 'integer' })
  position: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
