import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDocumentsAndSections1783300000000 implements MigrationInterface {
  name = 'CreateDocumentsAndSections1783300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // uuid-ossp is already enabled by CreateUsers, but this migration must
    // stand alone (e.g. if run against a fresh DB in isolation).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(
      `CREATE TABLE "documents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "title" character varying NOT NULL, "doc_type" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'draft', "style_config" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ac51aa5181ee2036f5ca482857c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "sections" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "document_id" uuid NOT NULL, "title" character varying NOT NULL, "content" text NOT NULL, "order" integer NOT NULL, "status" character varying NOT NULL DEFAULT 'draft', "word_count" integer NOT NULL DEFAULT 0, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f9749dd3bffd880a497d007e450" PRIMARY KEY ("id"))`,
    );

    // Index names match what TypeORM's default naming strategy generates for
    // the corresponding `@Index()`/`@Index(name, [...])` decorators (see the
    // comment in `AddConnectorComposioAccountIndex` for the derivation), so a
    // future `migration:generate` diff sees no drift against entity metadata.
    await queryRunner.query(
      `CREATE INDEX "IDX_c7481daf5059307842edef74d7" ON "documents" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b8c77e3604bb9ec1226da4b422" ON "sections" ("document_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sections_document_order" ON "sections" ("document_id", "order") `,
    );

    await queryRunner.query(
      `ALTER TABLE "documents" ADD CONSTRAINT "FK_c7481daf5059307842edef74d73" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sections" ADD CONSTRAINT "FK_b8c77e3604bb9ec1226da4b422c" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sections" DROP CONSTRAINT "FK_b8c77e3604bb9ec1226da4b422c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" DROP CONSTRAINT "FK_c7481daf5059307842edef74d73"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_sections_document_order"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b8c77e3604bb9ec1226da4b422"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c7481daf5059307842edef74d7"`,
    );
    await queryRunner.query(`DROP TABLE "sections"`);
    await queryRunner.query(`DROP TABLE "documents"`);
  }
}
