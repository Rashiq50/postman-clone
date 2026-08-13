import { MigrationInterface, QueryRunner } from 'typeorm';

/** SHA-256 hex of `Password123!` — matches common/crypto/sha256.ts */
const SEED_PASSWORD_HASH =
  'a109e36947ad56de1dca1cc49f0ef8ac9ad9a7b1aa0df41fb3c4cb73c1ff01ea';

export class UpdateSeedUserPasswordToSha2561786626100000 implements MigrationInterface {
  name = 'UpdateSeedUserPasswordToSha2561786626100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "users"
       SET "passwordHash" = $1
       WHERE "email" = 'rashiqrahaman@yahoo.com'`,
      [SEED_PASSWORD_HASH],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "users"
       SET "passwordHash" = $1
       WHERE "email" = 'rashiqrahaman@yahoo.com'`,
      [
        '$argon2id$v=19$m=65536,p=4,t=3$B7RaUHaA2JuVkodkBid7pg$SxQ1frr9gnxEARsNtoKSikMADfOzCBddLSej1oSLFL0',
      ],
    );
  }
}
