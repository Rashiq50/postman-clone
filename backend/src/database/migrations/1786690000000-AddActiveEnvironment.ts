import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Which environment a **member** has selected in a workspace.
 *
 * It sits on `workspace_members`, not on `workspaces`, because it is a property
 * of the person rather than of the workspace — the same kind of field as
 * `role`, joined from the same row, and surfaced on the wire the same way.
 *
 * ⚠️ **`ON DELETE SET NULL`, and this is the single most dangerous line in the
 * migration.** `CASCADE` here would delete the *membership row* when an
 * environment is deleted — a user silently evicted from a workspace because
 * someone tidied up an environment, with no repair path, since there is no
 * invite endpoint. `RESTRICT` would make an environment undeletable while
 * anyone had it selected. `SET NULL` degrades to "no environment", which is
 * exactly the recoverable state, and it is also what makes a stale
 * `activeEnvironmentId` unrepresentable: the read answers a live environment or
 * null, never a dangling reference.
 *
 * No index: the row is always reached through the existing
 * `UQ_workspace_members_workspace_user`.
 */
export class AddActiveEnvironment1786690000000 implements MigrationInterface {
  name = 'AddActiveEnvironment1786690000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workspace_members" ADD "activeEnvironmentId" uuid`,
    );
    await queryRunner.query(`
      ALTER TABLE "workspace_members"
        ADD CONSTRAINT "FK_workspace_members_activeEnvironmentId"
        FOREIGN KEY ("activeEnvironmentId") REFERENCES "environments"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workspace_members" DROP CONSTRAINT "FK_workspace_members_activeEnvironmentId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_members" DROP COLUMN "activeEnvironmentId"`,
    );
  }
}
