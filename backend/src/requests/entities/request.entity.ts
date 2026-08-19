import type {
  HttpMethod,
  KeyValueEntry,
  RequestAuth,
  RequestBody,
} from '@postman-clone/contracts';
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
import { CollectionEntity } from '../../collections/entities/collection.entity';
import { FolderEntity } from '../../collections/entities/folder.entity';

/**
 * A saved HTTP request. Named `RequestEntity`, and its wire type is
 * `ApiRequest`, because `Request` collides with both the DOM global and
 * Express's own type.
 *
 * Hybrid storage: anything the sidebar renders or the API filters on — `name`,
 * `method`, `url`, `position`, the parent ids — is a real column; anything only
 * the editor ever reads whole is `jsonb`.
 *
 * ⚠️ Like `FolderEntity`, the folder link is really a **composite** foreign key
 * (`("folderId","collectionId")`) owned by the migration — so `migration:generate`
 * proposes replacing it with a single-column FK on every run, and that diff is
 * expected and must be discarded. See the same note on `FolderEntity`.
 *
 * Its `MATCH SIMPLE` behaviour is load-bearing: with `folderId` NULL the
 * constraint is not checked at all, and that is precisely how a request sits at
 * the collection root. `MATCH FULL` would forbid every root-level request.
 */
@Entity('requests')
// The migration owns this constraint; declaring it here too keeps
// `migration:generate` from proposing to drop it.
@Check(
  'CHK_requests_method',
  `"method" IN ('GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS')`,
)
@Index('IDX_requests_collectionId_folder_position', [
  'collection',
  'folder',
  'position',
])
export class RequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => CollectionEntity, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'collectionId',
    foreignKeyConstraintName: 'FK_requests_collectionId',
  })
  collection: CollectionEntity;

  @RelationId((request: RequestEntity) => request.collection)
  collectionId: string;

  @ManyToOne(() => FolderEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'folderId' })
  folder: FolderEntity | null;

  @RelationId((request: RequestEntity) => request.folder)
  folderId: string | null;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  /** `varchar` + a CHECK constraint, never `type: 'enum'` — see the note on
   *  `WorkspaceMemberEntity.role`. */
  @Column({ type: 'varchar', length: 10, default: 'GET' })
  method: HttpMethod;

  /** Defaults to empty: a request exists before it has a URL. */
  @Column({ type: 'text', default: '' })
  url: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  // ⚠️ jsonb defaults must be SQL expressions — `default: []` makes
  // `migration:generate` compare a JS value against a SQL default, see a
  // mismatch, and emit churn on every run forever.
  //
  // Two details about the spelling, both established by running
  // `migration:generate` and diffing rather than by guessing. It must match
  // what Postgres *stores*, which normalizes a space in after the colon
  // (`'{"mode": "none"}'`) rather than the compact form the migration writes.
  // And it carries **no `::jsonb` cast**: TypeORM strips the cast before
  // comparing, so including one makes every run emit a no-op ALTER COLUMN.
  @Column({ type: 'jsonb', default: () => `'[]'` })
  headers: KeyValueEntry[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  queryParams: KeyValueEntry[];

  @Column({ type: 'jsonb', default: () => `'{"mode": "none"}'` })
  body: RequestBody;

  /** ⚠️ Holds bearer tokens and passwords in plaintext. See the README. */
  @Column({ type: 'jsonb', default: () => `'{"type": "inherit"}'` })
  auth: RequestAuth;

  @Column({ type: 'integer' })
  position: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
