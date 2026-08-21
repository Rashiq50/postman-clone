import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `request_executions` — the record of every send.
 *
 * Hand-written rather than generated, for the reason recorded on
 * `AddRequestScripts`: `migration:generate` cannot express the two composite
 * foreign keys (`FK_folders_parent`, `FK_requests_folder`) and proposes
 * replacing each with a single-column FK on every run, so a generated file
 * arrives carrying a schema regression that has to be edited back out.
 *
 * Two details worth naming:
 *
 * - `environmentId` is a plain `uuid` with **no foreign key**. An execution is
 *   a historical fact and must survive its environment being deleted; an FK
 *   with `SET NULL` would rewrite history to claim no environment was used.
 * - The three defaulted jsonb columns are written `'[]'::jsonb` here and
 *   declared spaced-and-uncast on the entity. That is not an inconsistency —
 *   Postgres normalizes what it stores and TypeORM strips the cast before
 *   comparing, and the two spellings are how the comparison comes out equal.
 *   `timing` gets no default at all: `'{}'` could never satisfy the contract's
 *   non-nullable `totalMs`, and every insert writes it.
 */
export class AddRequestExecutions1786680000000 implements MigrationInterface {
  name = 'AddRequestExecutions1786680000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "request_executions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "requestId" uuid NOT NULL,
        "userId" uuid,
        "environmentId" uuid,
        "method" character varying(10) NOT NULL,
        "url" text NOT NULL,
        "outcome" character varying(16) NOT NULL,
        "status" integer,
        "statusText" text,
        "failureKind" character varying(32),
        "failureMessage" text,
        "usedDraft" boolean NOT NULL DEFAULT false,
        "bodyEncoding" character varying(8),
        "body" text,
        "bodyBytes" integer,
        "bodyTruncated" boolean NOT NULL DEFAULT false,
        "durationMs" integer NOT NULL,
        "headers" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "redirects" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "timing" jsonb NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_request_executions_outcome"
          CHECK ("outcome" IN ('response','failure')),
        CONSTRAINT "PK_request_executions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "request_executions"
        ADD CONSTRAINT "FK_request_executions_requestId"
        FOREIGN KEY ("requestId") REFERENCES "requests"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    // SET NULL, not CASCADE: deleting a user must not erase the history of
    // what was sent from a shared workspace.
    await queryRunner.query(`
      ALTER TABLE "request_executions"
        ADD CONSTRAINT "FK_request_executions_userId"
        FOREIGN KEY ("userId") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    // Serves the history pane and the per-request prune.
    await queryRunner.query(`
      CREATE INDEX "IDX_request_executions_requestId_createdAt"
        ON "request_executions" ("requestId", "createdAt" DESC)
    `);

    // Serves the age sweep, which has no request id to narrow on.
    await queryRunner.query(`
      CREATE INDEX "IDX_request_executions_createdAt"
        ON "request_executions" ("createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "request_executions"`);
  }
}
