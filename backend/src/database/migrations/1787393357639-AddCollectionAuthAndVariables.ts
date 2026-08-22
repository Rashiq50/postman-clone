import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Collection-level auth and variables, for the Postman import slice.
 *
 * ⚠️ `migration:generate` also proposed dropping `FK_folders_parent`,
 * `FK_requests_folder` and the three `sessions`/`refresh_tokens` foreign keys
 * and re-adding them under generated single-column names. **That is the known,
 * expected drift** recorded in CLAUDE.md — the two composite keys cannot be
 * expressed on a TypeORM entity, so the migrations own them, and the session
 * FK names are pre-existing. All of it was discarded; what remains below is the
 * whole of the real change.
 *
 * Both defaults are spelled the way Postgres normalizes them (a space after the
 * colon) and carry no `::jsonb` cast, matching the entity — otherwise the next
 * `migration:generate` emits a no-op ALTER COLUMN forever.
 */
export class AddCollectionAuthAndVariables1787393357639 implements MigrationInterface {
  name = 'AddCollectionAuthAndVariables1787393357639';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "collections" ADD "auth" jsonb NOT NULL DEFAULT '{"type": "none"}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "collections" ADD "variables" jsonb NOT NULL DEFAULT '[]'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "collections" DROP COLUMN "variables"`,
    );
    await queryRunner.query(`ALTER TABLE "collections" DROP COLUMN "auth"`);
  }
}
