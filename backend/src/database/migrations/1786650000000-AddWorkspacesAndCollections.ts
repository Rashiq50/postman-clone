import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Postman domain: workspaces and their members, collections, folders,
 * requests and environments — plus the backfill that gives every existing user
 * a personal workspace.
 *
 * One migration rather than five because these are one atomic schema unit:
 * `workspaces` without `workspace_members` authorizes nothing, and
 * `collections` without the backfill leaves every existing user staring at an
 * app with no workspace to open. Same reasoning as `AddUsersAndSessions`.
 *
 * Hand-written because `migration:generate` cannot express any of the three
 * things that make this schema work: the composite self-referencing foreign
 * keys, the partial unique index, or the backfill.
 */
export class AddWorkspacesAndCollections1786650000000 implements MigrationInterface {
  name = 'AddWorkspacesAndCollections1786650000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---------------------------------------------------------- workspaces

    await queryRunner.query(
      `CREATE TABLE "workspaces" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid, "ownerUserId" uuid NOT NULL, "name" character varying(120) NOT NULL, "isPersonal" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_workspaces" PRIMARY KEY ("id"))`,
    );
    // ON DELETE CASCADE is correct only while every workspace is personal.
    // When sharing lands this must become RESTRICT plus an ownership-transfer
    // endpoint, or deleting one user silently deletes a whole team's
    // collections. It is also what makes the e2e cleanup work by email prefix,
    // so changing it is a paired change.
    await queryRunner.query(
      `ALTER TABLE "workspaces" ADD CONSTRAINT "FK_workspaces_ownerUserId" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_workspaces_ownerUserId" ON "workspaces" ("ownerUserId")`,
    );
    // Partial: every row is NULL today, so this index costs nothing until
    // organizations exist. No FK and no `organizations` table yet — this
    // column is a reserved seam, deliberately unconstrained.
    await queryRunner.query(
      `CREATE INDEX "IDX_workspaces_organizationId" ON "workspaces" ("organizationId") WHERE "organizationId" IS NOT NULL`,
    );
    // One personal workspace per user, enforced by the database. This is also
    // what makes provisioning and the backfill below idempotent.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_workspaces_personal_owner" ON "workspaces" ("ownerUserId") WHERE "isPersonal"`,
    );

    // --------------------------------------------------- workspace_members

    await queryRunner.query(
      `CREATE TABLE "workspace_members" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspaceId" uuid NOT NULL, "userId" uuid NOT NULL, "role" character varying(16) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_workspace_members" PRIMARY KEY ("id"))`,
    );
    // varchar + CHECK rather than a Postgres enum type, deviating from
    // `tasks_status_enum` on purpose: changing an enum is always a
    // multi-migration dance (a new value cannot be used until its transaction
    // commits, and removing one is not supported), while a CHECK is DROP +
    // ADD in a single statement. Role sets churn; task status did not.
    await queryRunner.query(
      `ALTER TABLE "workspace_members" ADD CONSTRAINT "CHK_workspace_members_role" CHECK ("role" IN ('OWNER','ADMIN','EDITOR','VIEWER'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_members" ADD CONSTRAINT "FK_workspace_members_workspaceId" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_members" ADD CONSTRAINT "FK_workspace_members_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    // A duplicate membership must be a 23505, not a silently doubled join.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_workspace_members_workspace_user" ON "workspace_members" ("workspaceId", "userId")`,
    );
    // Drives every authorization query in the app.
    await queryRunner.query(
      `CREATE INDEX "IDX_workspace_members_userId" ON "workspace_members" ("userId")`,
    );

    // --------------------------------------------------------- collections

    // No DEFAULT on any `position` column anywhere: the service always assigns
    // MAX + 1024, so a default is a value the ordering logic never produces.
    // The only thing it could ever do is mask a code path that forgot to
    // compute one — better a not-null violation than a row silently sorted
    // first. No uniqueness on `name` either: Postman allows duplicates, and a
    // 409 here is a worse experience than two identically named collections.
    await queryRunner.query(
      `CREATE TABLE "collections" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspaceId" uuid NOT NULL, "name" character varying(200) NOT NULL, "description" text, "position" integer NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_collections" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "collections" ADD CONSTRAINT "FK_collections_workspaceId" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_collections_workspaceId_position" ON "collections" ("workspaceId", "position")`,
    );

    // ------------------------------------------------------------- folders

    // `collectionId` is denormalized — the parent chain already implies it —
    // so the tree read is one flat SELECT per table and the authorization join
    // is a single hop rather than a recursion.
    await queryRunner.query(
      `CREATE TABLE "folders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "collectionId" uuid NOT NULL, "parentFolderId" uuid, "name" character varying(200) NOT NULL, "position" integer NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_folders" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "folders" ADD CONSTRAINT "FK_folders_collectionId" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    // Redundant against the primary key on its own. It exists solely to give
    // the composite foreign keys below a unique constraint to reference.
    await queryRunner.query(
      `ALTER TABLE "folders" ADD CONSTRAINT "UQ_folders_id_collectionId" UNIQUE ("id", "collectionId")`,
    );
    // The composite self-FK makes "my parent lives in a different collection"
    // unrepresentable in SQL rather than a service invariant someone forgets,
    // and deleting a folder cascades its entire subtree with no service code.
    // Deliberate consequence: a folder cannot change collection without
    // rewriting every descendant, so cross-collection move is out of scope —
    // and the schema says so rather than the docs.
    await queryRunner.query(
      `ALTER TABLE "folders" ADD CONSTRAINT "FK_folders_parent" FOREIGN KEY ("parentFolderId", "collectionId") REFERENCES "folders"("id", "collectionId") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_folders_collectionId_parent_position" ON "folders" ("collectionId", "parentFolderId", "position")`,
    );

    // ------------------------------------------------------------ requests

    // The hybrid split: anything the sidebar renders or the API filters on is
    // a real column; anything only the editor reads whole is jsonb.
    await queryRunner.query(
      `CREATE TABLE "requests" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "collectionId" uuid NOT NULL, "folderId" uuid, "name" character varying(200) NOT NULL, "method" character varying(10) NOT NULL DEFAULT 'GET', "url" text NOT NULL DEFAULT '', "description" text, "headers" jsonb NOT NULL DEFAULT '[]'::jsonb, "queryParams" jsonb NOT NULL DEFAULT '[]'::jsonb, "body" jsonb NOT NULL DEFAULT '{"mode":"none"}'::jsonb, "auth" jsonb NOT NULL DEFAULT '{"type":"inherit"}'::jsonb, "position" integer NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_requests" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" ADD CONSTRAINT "CHK_requests_method" CHECK ("method" IN ('GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" ADD CONSTRAINT "FK_requests_collectionId" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    // ⚠️ MATCH SIMPLE — the Postgres default, and load-bearing. With `folderId`
    // NULL the composite constraint is not checked at all, and that is exactly
    // how a request sits at the collection root. MATCH FULL would forbid every
    // root-level request, and the error would read as an FK bug rather than
    // the semantics change it actually is.
    await queryRunner.query(
      `ALTER TABLE "requests" ADD CONSTRAINT "FK_requests_folder" FOREIGN KEY ("folderId", "collectionId") REFERENCES "folders"("id", "collectionId") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_requests_collectionId_folder_position" ON "requests" ("collectionId", "folderId", "position")`,
    );

    // -------------------------------------------------------- environments

    await queryRunner.query(
      `CREATE TABLE "environments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspaceId" uuid NOT NULL, "name" character varying(200) NOT NULL, "variables" jsonb NOT NULL DEFAULT '[]'::jsonb, "position" integer NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_environments" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "environments" ADD CONSTRAINT "FK_environments_workspaceId" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_environments_workspaceId_position" ON "environments" ("workspaceId", "position")`,
    );

    // ------------------------------------------------------------ backfill

    // A user with no workspace is a silently and permanently broken account:
    // registration still returns 201 with a working token, `GET /workspaces`
    // is empty, and no endpoint repairs it. NOT EXISTS rather than a bare
    // INSERT … SELECT so this is idempotent and composes with the partial
    // unique index above.
    //
    // The literal name is duplicated with PERSONAL_WORKSPACE_NAME on purpose:
    // a migration must keep producing the same result forever, so it does not
    // import application code.
    await queryRunner.query(
      `INSERT INTO "workspaces" ("ownerUserId", "name", "isPersonal") SELECT u."id", 'My Workspace', true FROM "users" u WHERE NOT EXISTS (SELECT 1 FROM "workspaces" w WHERE w."ownerUserId" = u."id" AND w."isPersonal")`,
    );
    // Driven off `workspaces` rather than `users`, so it also repairs a
    // workspace whose membership row was somehow lost.
    await queryRunner.query(
      `INSERT INTO "workspace_members" ("workspaceId", "userId", "role") SELECT w."id", w."ownerUserId", 'OWNER' FROM "workspaces" w WHERE w."isPersonal" AND NOT EXISTS (SELECT 1 FROM "workspace_members" m WHERE m."workspaceId" = w."id" AND m."userId" = w."ownerUserId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Exact inverse order. Dropping the tables takes the backfilled rows with
    // them, so there is no data step to undo.
    await queryRunner.query(`DROP TABLE "environments"`);
    await queryRunner.query(`DROP TABLE "requests"`);
    await queryRunner.query(`DROP TABLE "folders"`);
    await queryRunner.query(`DROP TABLE "collections"`);
    await queryRunner.query(`DROP TABLE "workspace_members"`);
    await queryRunner.query(`DROP TABLE "workspaces"`);
  }
}
