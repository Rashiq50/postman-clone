import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dev-only seed user. Password: Password123!
 * passwordHash is SHA-256 hex of the plaintext password.
 */
const SEED_USER = {
  name: 'Rashiq Rahman',
  email: 'rashiqrahaman@yahoo.com',
  passwordHash:
    'a109e36947ad56de1dca1cc49f0ef8ac9ad9a7b1aa0df41fb3c4cb73c1ff01ea',
} as const;

export class AddUserNameAndSeedTestUser1786626000000 implements MigrationInterface {
  name = 'AddUserNameAndSeedTestUser1786626000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "name" character varying NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "name" DROP DEFAULT`,
    );
    await queryRunner.query(
      `INSERT INTO "users" ("name", "email", "passwordHash")
       VALUES ($1, $2, $3)
       ON CONFLICT ("email") DO NOTHING`,
      [SEED_USER.name, SEED_USER.email, SEED_USER.passwordHash],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "users" WHERE "email" = $1`, [
      SEED_USER.email,
    ]);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "name"`);
  }
}
