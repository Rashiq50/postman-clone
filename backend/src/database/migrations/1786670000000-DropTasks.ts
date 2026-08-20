import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the `tasks` table. Tasks were the preliminary CRUD scaffolding that
 * proved out the guard, the DTO/contract seam and the error envelope; the
 * domain (workspaces → collections → requests) replaced them entirely.
 *
 * The earlier migrations that created and then extended `tasks` are left
 * untouched — history is not rewritten, so a database migrated from empty
 * still creates the table and then drops it here.
 *
 * `down` recreates the table in its final shape (owner column, index and FK
 * folded in), not the shape `InitialSchema` left it in: a rollback has to
 * land on a schema the previous migration's own `down` can then undo.
 */
export class DropTasks1786670000000 implements MigrationInterface {
  name = 'DropTasks1786670000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "tasks"`);
    await queryRunner.query(`DROP TYPE "public"."tasks_status_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."tasks_status_enum" AS ENUM('TODO', 'IN_PROGRESS', 'DONE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "tasks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying(255) NOT NULL, "description" text, "status" "public"."tasks_status_enum" NOT NULL DEFAULT 'TODO', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "ownerId" uuid NOT NULL, CONSTRAINT "PK_8d12ff38fcc62aaba2cab748772" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tasks_ownerId" ON "tasks" ("ownerId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD CONSTRAINT "FK_tasks_ownerId" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
