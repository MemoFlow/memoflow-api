import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roadmap item 3 — templates (PG). `template_sections.title` is a
 * deliberate addition beyond `docs/database-schema.md`: sections created
 * from a template need headings.
 *
 * Index/FK/PK names below match what TypeORM's default naming strategy
 * generates for the corresponding entity decorators (verified directly
 * against `DefaultNamingStrategy` — see the comment in
 * `AddConnectorComposioAccountIndex` for the derivation), so a future
 * `migration:generate` diff sees no drift against entity metadata.
 */
export class CreateTemplates1783400000000 implements MigrationInterface {
  name = 'CreateTemplates1783400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // uuid-ossp is already enabled by CreateUsers, but this migration must
    // stand alone (e.g. if run against a fresh DB in isolation).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(
      `CREATE TABLE "templates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying NOT NULL, "doc_type" character varying NOT NULL, "scope" character varying NOT NULL, "created_by" uuid, "style_config" jsonb, "is_published" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_515948649ce0bbbe391de702ae5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "template_sections" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "template_id" uuid NOT NULL, "title" character varying NOT NULL, "order" integer NOT NULL, "word_count_min" integer NOT NULL, "word_count_max" integer NOT NULL, "is_required" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_98dfac771db4c25e1e6ec3b3019" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "document_templates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "document_id" uuid NOT NULL, "template_id" uuid NOT NULL, "applied_at" TIMESTAMP WITH TIME ZONE NOT NULL, "customised" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_0372838b7b7cd3571aef80466d1" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_ce8836f896321c5dccfa8a1c8a" ON "templates" ("doc_type") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ca479017ddf61cd72db7962c96" ON "templates" ("scope") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4d10291501d15046748abcf51e" ON "templates" ("is_published") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3c3fd9662c1f9998a84dff1657" ON "template_sections" ("template_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_template_sections_template_order" ON "template_sections" ("template_id", "order") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1d32fea01e958a78b61a154505" ON "document_templates" ("document_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5436a1a31f3bd88299f2261a27" ON "document_templates" ("template_id") `,
    );

    // created_by is nullable (system templates); ON DELETE SET NULL turns a
    // deleted user's templates into system templates rather than deleting
    // them.
    await queryRunner.query(
      `ALTER TABLE "templates" ADD CONSTRAINT "FK_e0753fa8d20f4eae08ebec1fef9" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "template_sections" ADD CONSTRAINT "FK_3c3fd9662c1f9998a84dff1657c" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "document_templates" ADD CONSTRAINT "FK_1d32fea01e958a78b61a1545054" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "document_templates" ADD CONSTRAINT "FK_5436a1a31f3bd88299f2261a273" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "document_templates" DROP CONSTRAINT "FK_5436a1a31f3bd88299f2261a273"`,
    );
    await queryRunner.query(
      `ALTER TABLE "document_templates" DROP CONSTRAINT "FK_1d32fea01e958a78b61a1545054"`,
    );
    await queryRunner.query(
      `ALTER TABLE "template_sections" DROP CONSTRAINT "FK_3c3fd9662c1f9998a84dff1657c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "templates" DROP CONSTRAINT "FK_e0753fa8d20f4eae08ebec1fef9"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."IDX_5436a1a31f3bd88299f2261a27"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1d32fea01e958a78b61a154505"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_template_sections_template_order"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3c3fd9662c1f9998a84dff1657"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4d10291501d15046748abcf51e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ca479017ddf61cd72db7962c96"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ce8836f896321c5dccfa8a1c8a"`,
    );

    await queryRunner.query(`DROP TABLE "document_templates"`);
    await queryRunner.query(`DROP TABLE "template_sections"`);
    await queryRunner.query(`DROP TABLE "templates"`);
  }
}
