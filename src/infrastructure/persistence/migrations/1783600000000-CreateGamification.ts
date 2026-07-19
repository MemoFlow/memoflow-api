import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roadmap item 6 — gamification (PG): `milestones`, `daily_missions`,
 * `mission_progress`.
 *
 * Two deliberate additions beyond `docs/database-schema.md`'s plain column
 * listing (mirrors how `document_versions`' compound index and
 * `connector_connections`' `(user_id, provider)` index are documented as
 * additions in their own migrations):
 *
 * - `IDX_milestones_user_document_type` — a UNIQUE composite index on
 *   `(user_id, document_id, milestone_type)`. This is the idempotent-award
 *   guard `MilestoneTypeOrmRepository.awardOnce` relies on
 *   (`INSERT ... ON CONFLICT DO NOTHING RETURNING *`): a double
 *   `document.created`/`section.created`/`section.updated` event can never
 *   award the same milestone twice.
 * - `IDX_mission_progress_user_mission` — a UNIQUE composite index on
 *   `(user_id, mission_id)`. `MissionProgressTypeOrmRepository.incrementAtomic`
 *   upserts against this index first (`ON CONFLICT DO NOTHING`), then runs a
 *   single guarded `UPDATE ... WHERE ... AND completed = false RETURNING *`
 *   so progress increments and the completion flip are race-safe.
 *
 * Neither ORM entity declares a `@ManyToOne` relation for its FK columns
 * (`user_id`, `document_id`, `mission_id`) — mirrors every other entity in
 * this codebase (`DocumentOrmEntity`, `SectionOrmEntity`,
 * `AiSuggestionOrmEntity`, `ConnectorConnectionOrmEntity`, ...): plain uuid
 * `@Column` + `@Index()`, with the actual FK constraint hand-added below.
 *
 * Index/FK/PK names for the single-column indexes and FKs below match what
 * TypeORM's default naming strategy generates for the corresponding entity
 * decorators (verified directly against `DefaultNamingStrategy` — see the
 * comment in `AddConnectorComposioAccountIndex` for the derivation), so a
 * future `migration:generate` diff sees no drift against entity metadata for
 * those. The two composite unique indexes above are explicitly named (like
 * `IDX_sections_document_order` / `UQ_connector_user_provider`), matching
 * the explicit names on their `@Index(name, [...], { unique: true })`
 * entity decorators.
 */
export class CreateGamification1783600000000 implements MigrationInterface {
  name = 'CreateGamification1783600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // uuid-ossp is already enabled by CreateUsers, but this migration must
    // stand alone (e.g. if run against a fresh DB in isolation).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(
      `CREATE TABLE "milestones" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "document_id" uuid NOT NULL, "milestone_type" character varying NOT NULL, "xp_awarded" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0bdbfe399c777a6a8520ff902d9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "daily_missions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying NOT NULL, "description" character varying NOT NULL, "xp_reward" integer NOT NULL, "criteria" jsonb NOT NULL, "active_date" date NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_010856f7a024506fcae38eeee16" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "mission_progress" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "mission_id" uuid NOT NULL, "progress" integer NOT NULL DEFAULT 0, "completed" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0667484709439992c15dcbae23f" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_0e3c65ca6c89021aab03eeb7b9" ON "milestones" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e6651e2f644fb3c16b892b5d81" ON "milestones" ("document_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_milestones_user_document_type" ON "milestones" ("user_id", "document_id", "milestone_type") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_446be121b9982912225663f2eb" ON "daily_missions" ("active_date") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8ef8ce2308bfff5c1b89d2d4d0" ON "mission_progress" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_054a67b5fcb2993886e54414b9" ON "mission_progress" ("mission_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_mission_progress_user_mission" ON "mission_progress" ("user_id", "mission_id") `,
    );

    await queryRunner.query(
      `ALTER TABLE "milestones" ADD CONSTRAINT "FK_0e3c65ca6c89021aab03eeb7b90" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "milestones" ADD CONSTRAINT "FK_e6651e2f644fb3c16b892b5d816" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mission_progress" ADD CONSTRAINT "FK_8ef8ce2308bfff5c1b89d2d4d08" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mission_progress" ADD CONSTRAINT "FK_054a67b5fcb2993886e54414b98" FOREIGN KEY ("mission_id") REFERENCES "daily_missions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "mission_progress" DROP CONSTRAINT "FK_054a67b5fcb2993886e54414b98"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mission_progress" DROP CONSTRAINT "FK_8ef8ce2308bfff5c1b89d2d4d08"`,
    );
    await queryRunner.query(
      `ALTER TABLE "milestones" DROP CONSTRAINT "FK_e6651e2f644fb3c16b892b5d816"`,
    );
    await queryRunner.query(
      `ALTER TABLE "milestones" DROP CONSTRAINT "FK_0e3c65ca6c89021aab03eeb7b90"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."IDX_mission_progress_user_mission"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_054a67b5fcb2993886e54414b9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8ef8ce2308bfff5c1b89d2d4d0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_446be121b9982912225663f2eb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_milestones_user_document_type"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e6651e2f644fb3c16b892b5d81"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0e3c65ca6c89021aab03eeb7b9"`,
    );

    await queryRunner.query(`DROP TABLE "mission_progress"`);
    await queryRunner.query(`DROP TABLE "daily_missions"`);
    await queryRunner.query(`DROP TABLE "milestones"`);
  }
}
