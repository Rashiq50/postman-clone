import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The pre-request and post-response script pair on `requests`.
 *
 * Hand-written rather than generated, for the reason recorded on
 * `RequestEntity`: `migration:generate` cannot express the two composite
 * foreign keys (`FK_folders_parent`, `FK_requests_folder`) and proposes
 * replacing each with a single-column FK on every run, so a generated file for
 * a one-column addition arrives carrying a schema regression that has to be
 * edited back out. Writing the ALTER directly avoids that entirely.
 *
 * The default is written compact and cast — `'{"preRequest":"","postRequest":""}'::jsonb`
 * — matching the style of every other jsonb default in `AddWorkspacesAndCollections`.
 * The entity declares the same value **spaced and uncast**, which is not an
 * inconsistency: Postgres normalizes what it stores, and TypeORM strips the cast
 * before comparing. The two spellings are how the comparison comes out equal.
 *
 * `NOT NULL DEFAULT` backfills every existing row with the empty pair, so no
 * separate UPDATE is needed and no request is ever read with a null `scripts`.
 */
export class AddRequestScripts1786660000000 implements MigrationInterface {
  name = 'AddRequestScripts1786660000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "requests" ADD "scripts" jsonb NOT NULL DEFAULT '{"preRequest":"","postRequest":""}'::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "requests" DROP COLUMN "scripts"`);
  }
}
