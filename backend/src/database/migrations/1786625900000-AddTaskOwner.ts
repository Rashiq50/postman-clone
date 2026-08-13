import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskOwner1786625900000 implements MigrationInterface {
  name = 'AddTaskOwner1786625900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Existing dev rows (if any) are removed — tasks without an owner are
    // invalid once auth lands. Safe on a fresh or demo database.
    await queryRunner.query(`DELETE FROM "tasks"`);

    await queryRunner.query(`ALTER TABLE "tasks" ADD "ownerId" uuid NOT NULL`);
    await queryRunner.query(
      `CREATE INDEX "IDX_tasks_ownerId" ON "tasks" ("ownerId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD CONSTRAINT "FK_tasks_ownerId" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP CONSTRAINT "FK_tasks_ownerId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_tasks_ownerId"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "ownerId"`);
  }
}
