import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  RelationId,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { CollectionEntity } from './collection.entity';

/**
 * A folder inside a collection. `parentFolderId` NULL means the collection root.
 *
 * ⚠️ The real parent constraint in the database is **composite** —
 * `("parentFolderId", "collectionId") → folders("id", "collectionId")` — which
 * is what makes a cross-collection parent unrepresentable in SQL. TypeORM
 * cannot express a two-column foreign key, so **the migration owns that
 * constraint** and this entity declares only the single-column relation below.
 *
 * The visible consequence: `migration:generate` always proposes dropping
 * `FK_folders_parent` and adding a single-column FK in its place. That diff is
 * expected and must be discarded — applying it would weaken the invariant to
 * something a service has to remember instead. It is the *only* drift these
 * tables produce; every other constraint, index and default is declared here
 * precisely so this one stays easy to recognise.
 */
@Entity('folders')
// Redundant against the primary key. It exists only to give the composite
// foreign keys a unique constraint to reference — see the class note.
@Unique('UQ_folders_id_collectionId', ['id', 'collection'])
@Index('IDX_folders_collectionId_parent_position', [
  'collection',
  'parentFolder',
  'position',
])
export class FolderEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Denormalized — the parent chain already implies it. Carried anyway so the
   * tree read is one flat SELECT per table and the authorization join is a
   * single hop rather than a recursive CTE.
   */
  @ManyToOne(() => CollectionEntity, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'collectionId',
    foreignKeyConstraintName: 'FK_folders_collectionId',
  })
  collection: CollectionEntity;

  @RelationId((folder: FolderEntity) => folder.collection)
  collectionId: string;

  /** See the composite-FK note on the class. */
  @ManyToOne(() => FolderEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'parentFolderId' })
  parentFolder: FolderEntity | null;

  @RelationId((folder: FolderEntity) => folder.parentFolder)
  parentFolderId: string | null;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'integer' })
  position: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
