import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Splits refresh tokens out of `sessions` into a child table, so a session can
 * survive rotation with a stable id while each token is spent exactly once.
 *
 * Hand-written rather than generated: `migration:generate` cannot express the
 * data step that carries live sessions across, and it would also try to drop
 * and recreate `IDX_sessions_userId`.
 */
export class AddRefreshTokenRotation1786640000000 implements MigrationInterface {
  name = 'AddRefreshTokenRotation1786640000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sessionId" uuid NOT NULL, "tokenHash" character varying(64) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "usedAt" TIMESTAMP WITH TIME ZONE, "revokedAt" TIMESTAMP WITH TIME ZONE, "replacedByTokenId" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_refresh_tokens" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_tokens_sessionId" ON "refresh_tokens" ("sessionId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_refresh_tokens_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    // Self-reference for forensics. SET NULL, not CASCADE: losing a child must
    // never take the row that points at it with it.
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_refresh_tokens_replacedByTokenId" FOREIGN KEY ("replacedByTokenId") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "sessions" ADD "userAgent" character varying(512)`,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" ADD "ipAddress" character varying(45)`,
    );

    // Carry live sessions forward. The hash algorithm is unchanged, so every
    // token already in the wild keeps working and nobody is logged out.
    await queryRunner.query(
      `INSERT INTO "refresh_tokens" ("sessionId", "tokenHash", "expiresAt") SELECT "id", "refreshTokenHash", "expiresAt" FROM "sessions" WHERE "revokedAt" IS NULL AND "expiresAt" > now()`,
    );

    // Added after the backfill on purpose: if two live sessions somehow shared
    // a hash, this fails loudly here rather than silently dropping one row.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_refresh_tokens_tokenHash" ON "refresh_tokens" ("tokenHash")`,
    );

    await queryRunner.query(
      `ALTER TABLE "sessions" DROP COLUMN "refreshTokenHash"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // A lossless down is not achievable. `sessions` held one token per session
    // and this table holds a chain, so the best reconstruction is each
    // session's newest unspent token. Sessions whose only tokens were already
    // spent get '' — a hash nothing can ever match, i.e. a session that can no
    // longer be refreshed. That is the correct failure direction: unusable
    // rather than usable by the wrong token.
    await queryRunner.query(
      `ALTER TABLE "sessions" ADD "refreshTokenHash" character varying NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(
      `UPDATE "sessions" AS s SET "refreshTokenHash" = t."tokenHash" FROM (SELECT DISTINCT ON ("sessionId") "sessionId", "tokenHash" FROM "refresh_tokens" WHERE "usedAt" IS NULL AND "revokedAt" IS NULL ORDER BY "sessionId", "createdAt" DESC) AS t WHERE t."sessionId" = s."id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" ALTER COLUMN "refreshTokenHash" DROP DEFAULT`,
    );

    await queryRunner.query(`ALTER TABLE "sessions" DROP COLUMN "ipAddress"`);
    await queryRunner.query(`ALTER TABLE "sessions" DROP COLUMN "userAgent"`);

    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_refresh_tokens_replacedByTokenId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_refresh_tokens_sessionId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_refresh_tokens_tokenHash"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_refresh_tokens_sessionId"`,
    );
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
  }
}
