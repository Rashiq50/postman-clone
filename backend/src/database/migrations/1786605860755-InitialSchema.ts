import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1786605860755 implements MigrationInterface {
  name = 'InitialSchema1786605860755';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // uuid_generate_v4() below comes from this extension. `synchronize`
    // used to create it implicitly; migrations do not, so without this the
    // very first migration fails on any fresh database (CI, a new laptop,
    // production).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(
      `CREATE TYPE "public"."tasks_status_enum" AS ENUM('TODO', 'IN_PROGRESS', 'DONE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "tasks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying(255) NOT NULL, "description" text, "status" "public"."tasks_status_enum" NOT NULL DEFAULT 'TODO', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8d12ff38fcc62aaba2cab748772" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "tasks"`);
    await queryRunner.query(`DROP TYPE "public"."tasks_status_enum"`);
  }
}
