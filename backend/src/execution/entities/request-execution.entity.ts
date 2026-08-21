import type {
  HttpMethod,
  RedirectHop,
  ResponseHeader,
  SendFailureKind,
  SendTiming,
  SendWarning,
} from '@raven/contracts';
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
} from 'typeorm';
import { RequestEntity } from '../../requests/entities/request.entity';
import { UserEntity } from '../../users/entities/user.entity';

/**
 * One recorded run of a request.
 *
 * ⚠️ **This is a *third* plaintext-secrets location**, beyond `requests.auth`
 * and `environments.variables`. It holds response bodies — which echo back
 * whatever the target reflects, `httpbin`-style — and the stored `url` and
 * `redirects`, which are redacted only for values the environment marked
 * `secret`. The per-request cap limits the blast radius; it does not remove it.
 *
 * ⚠️ **Sent request headers are deliberately not stored.** There is no
 * `sentHeaders` column, and that omission is what keeps the freshly built
 * `Authorization` header out of this table entirely. The cost is real and
 * accepted: a history row (especially a `usedDraft` one) shows what came back
 * but not what went out beyond method and URL. Do not "complete" the row with
 * the most secret-laden column in the feature.
 *
 * **No `position` column.** Ordering is `createdAt DESC, id DESC` — there is
 * nothing to drag.
 */
@Entity('request_executions')
// `varchar` + CHECK, never a Postgres enum — the reasoning is on
// `WorkspaceMemberEntity.role`: a CHECK is one statement to change.
@Check('CHK_request_executions_outcome', `"outcome" IN ('response','failure')`)
// Serves the history pane and the per-request prune.
@Index('IDX_request_executions_requestId_createdAt', ['request', 'createdAt'])
// Serves the age sweep, which has no request id to narrow on. ⚠️ Declared here
// as well as in the migration on purpose: an index the migration owns and no
// entity declares makes `migration:generate` propose dropping it on every run.
// Everything about this table is declared on the entity precisely so the known
// composite-FK noise stays the *only* diff and therefore stays recognisable.
@Index('IDX_request_executions_createdAt', ['createdAt'])
export class RequestExecutionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => RequestEntity, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'requestId',
    foreignKeyConstraintName: 'FK_request_executions_requestId',
  })
  request: RequestEntity;

  @RelationId((execution: RequestExecutionEntity) => execution.request)
  requestId: string;

  /** Who pressed Send. `SET NULL` so deleting a user does not erase history. */
  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'userId',
    foreignKeyConstraintName: 'FK_request_executions_userId',
  })
  user: UserEntity | null;

  @RelationId((execution: RequestExecutionEntity) => execution.user)
  userId: string | null;

  /**
   * ⚠️ A plain column with **no foreign key**, on purpose: an execution is a
   * historical fact and must survive its environment being deleted. An FK with
   * `SET NULL` would rewrite history to say no environment was used; one with
   * `RESTRICT` would make an environment undeletable once it had been sent
   * with.
   */
  @Column({ type: 'uuid', nullable: true })
  environmentId: string | null;

  @Column({ type: 'varchar', length: 10 })
  method: HttpMethod;

  /** Secret-redacted before it is written. See `redact.ts`. */
  @Column({ type: 'text' })
  url: string;

  @Column({ type: 'varchar', length: 16 })
  outcome: 'response' | 'failure';

  @Column({ type: 'integer', nullable: true })
  status: number | null;

  @Column({ type: 'text', nullable: true })
  statusText: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  failureKind: SendFailureKind | null;

  @Column({ type: 'text', nullable: true })
  failureMessage: string | null;

  /** True when the run used the editor's unsaved draft rather than the row. */
  @Column({ type: 'boolean', default: false })
  usedDraft: boolean;

  @Column({ type: 'varchar', length: 8, nullable: true })
  bodyEncoding: 'text' | 'base64' | 'empty' | null;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  /** The size of the body as received, which may exceed what is stored. */
  @Column({ type: 'integer', nullable: true })
  bodyBytes: number | null;

  @Column({ type: 'boolean', default: false })
  bodyTruncated: boolean;

  @Column({ type: 'integer' })
  durationMs: number;

  // ⚠️ jsonb defaults are SQL expressions with **no `::jsonb` cast**, spelled
  // the way Postgres normalizes them. `default: []` compares a JS value against
  // a SQL default and a cast is stripped before comparison — either one makes
  // `migration:generate` emit the same no-op ALTER COLUMN forever. Four jsonb
  // columns are four chances to get that wrong. See `RequestEntity.headers`.
  @Column({ type: 'jsonb', default: () => `'[]'` })
  headers: ResponseHeader[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  warnings: SendWarning[];

  /** ⚠️ Redacted alongside `url` — a `?token=…` would otherwise survive here. */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  redirects: RedirectHop[];

  /**
   * ⚠️ **No default, deliberately.** `'{}'` can never satisfy the contract's
   * non-nullable `totalMs`, and the column is written on every insert — so a
   * default could only ever mask a path that forgot to write it. The same
   * argument recorded for `RequestEntity.position`.
   */
  @Column({ type: 'jsonb' })
  timing: SendTiming;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
