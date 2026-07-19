import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roadmap item 5 — AI layer (PG side): `prompts` (no public controller —
 * repository-internal active-prompt lookup, seeded via `scripts/seed.ts`)
 * and `ai_suggestions`. `ai_suggestions.section_id`/`user_id` plain indexes
 * are a deliberate addition beyond `docs/database-schema.md` — both are FK
 * lookup paths on every suggestions-list/generate/review call.
 * `ai_suggestions.status` also gets a hand-written CHECK constraint
 * (`CHK_ai_suggestions_status`) restricting it to the three values the
 * domain enum allows — deliberately NOT mirrored as an entity decorator
 * (`AiSuggestionOrmEntity.status` stays plain `varchar`), so there is no
 * corresponding drift for a future `migration:generate` diff to flag.
 *
 * Index/FK/PK names below match what TypeORM's default naming strategy
 * generates for the corresponding entity decorators (verified directly
 * against `DefaultNamingStrategy` — see the comment in
 * `AddConnectorComposioAccountIndex` for the derivation), so a future
 * `migration:generate` diff sees no drift against entity metadata.
 */
export class CreateAiLayer1783500000000 implements MigrationInterface {
  name = 'CreateAiLayer1783500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // uuid-ossp is already enabled by CreateUsers, but this migration must
    // stand alone (e.g. if run against a fresh DB in isolation).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(
      `CREATE TABLE "prompts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "feature_type" character varying NOT NULL, "version" character varying NOT NULL, "template" text NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_21f33798862975179e40b216a1d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "ai_suggestions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "section_id" uuid NOT NULL, "user_id" uuid NOT NULL, "feature_type" character varying NOT NULL, "original_text" text NOT NULL, "suggested_text" text NOT NULL, "status" character varying NOT NULL DEFAULT 'pending', "prompt_version" character varying NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5c769622a5d4b1e17e34983f75d" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_2e2a6eaa5a1f488e434a85ea74" ON "prompts" ("feature_type") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b06ad86d9493a46bcbecb8cb45" ON "prompts" ("is_active") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dbd26a8c97ac505ae78aef48b9" ON "ai_suggestions" ("section_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_043d3a77d24ce1e0ebf9823433" ON "ai_suggestions" ("user_id") `,
    );

    await queryRunner.query(
      `ALTER TABLE "ai_suggestions" ADD CONSTRAINT "FK_dbd26a8c97ac505ae78aef48b9e" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_suggestions" ADD CONSTRAINT "FK_043d3a77d24ce1e0ebf9823433c" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_suggestions" ADD CONSTRAINT "CHK_ai_suggestions_status" CHECK ("status" IN ('pending', 'accepted', 'rejected'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_suggestions" DROP CONSTRAINT "CHK_ai_suggestions_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_suggestions" DROP CONSTRAINT "FK_043d3a77d24ce1e0ebf9823433c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_suggestions" DROP CONSTRAINT "FK_dbd26a8c97ac505ae78aef48b9e"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."IDX_043d3a77d24ce1e0ebf9823433"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dbd26a8c97ac505ae78aef48b9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b06ad86d9493a46bcbecb8cb45"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2e2a6eaa5a1f488e434a85ea74"`,
    );

    await queryRunner.query(`DROP TABLE "ai_suggestions"`);
    await queryRunner.query(`DROP TABLE "prompts"`);
  }
}
