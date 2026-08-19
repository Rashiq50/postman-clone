import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves the dev seed user off the fast SHA-256 digest and back onto Argon2id,
 * matching common/crypto/password.ts. Real users would need a rehash-on-login
 * path instead; the seed row is the only one that exists, so a straight UPDATE
 * is enough here.
 *
 * Password is unchanged: Password123!
 */
const SEED_EMAIL = 'rashiqrahaman@yahoo.com';

/** Argon2id (m=19456, t=2, p=1) hash of `Password123!`. */
const ARGON2_HASH =
  '$argon2id$v=19$m=19456,p=1,t=2$i2lgHlFVaVd2oN/uXyDuWw$HTzlRPqDt7ggDLjRweO4M7aY5C1/pkoiX98ZTTPd4aQ';

/** The SHA-256 hex this replaces, restored by `down`. */
const SHA256_HASH =
  'a109e36947ad56de1dca1cc49f0ef8ac9ad9a7b1aa0df41fb3c4cb73c1ff01ea';

export class UpgradeSeedUserPasswordToArgon21786631900000 implements MigrationInterface {
  name = 'UpgradeSeedUserPasswordToArgon21786631900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "users" SET "passwordHash" = $1 WHERE "email" = $2`,
      [ARGON2_HASH, SEED_EMAIL],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "users" SET "passwordHash" = $1 WHERE "email" = $2`,
      [SHA256_HASH, SEED_EMAIL],
    );
  }
}
