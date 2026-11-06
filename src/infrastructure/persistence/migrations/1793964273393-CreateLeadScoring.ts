import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `users.created_at`, creates `onboarding_profiles`, `lead_signals` and `lead_scores` (see
 * docs/database-schema.md) and backfills a score for users who already have an
 * active connector.
 *
 * Generated via `migration:generate` against a scratch database with all
 * earlier migrations applied, then pruned to just the three tables — TypeORM's
 * Postgres introspection also proposed dropping and re-adding unrelated
 * FK/CHECK constraints, which is reordering noise (same as in
 * AddUserDisabledAt). The entities declare no `@ManyToOne` relations, so the
 * `user_id` FKs (ON DELETE CASCADE) are hand-added here, as in
 * CreateGamification.
 */
export class CreateLeadScoring1793964273393 implements MigrationInterface {
  name = 'CreateLeadScoring1793964273393';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Existing users get the migration time as their creation date (the true
    // value was never recorded).
    await queryRunner.query(
      `ALTER TABLE "users" ADD "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `CREATE TABLE "lead_scores" ("user_id" uuid NOT NULL, "score" integer NOT NULL, "tier" character varying NOT NULL, "breakdown" jsonb NOT NULL, "computed_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "CHK_lead_scores_tier" CHECK ("tier" IN ('hot', 'warm', 'cold')), CONSTRAINT "PK_b9af0bd0c5ea78d6cd9f4f51da0" PRIMARY KEY ("user_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d2c4665a80e6900f42a91e92e6" ON "lead_scores"  ("score") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4f3acfd14f80575381fcb71fc0" ON "lead_scores"  ("tier") `,
    );
    await queryRunner.query(
      `CREATE TABLE "lead_signals" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "type" character varying NOT NULL, "first_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL, "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL, "occurrences" integer NOT NULL DEFAULT '1', CONSTRAINT "PK_925718b2438a79cc39a87977368" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_lead_signals_user_type" ON "lead_signals"  ("user_id", "type") `,
    );
    await queryRunner.query(
      `CREATE TABLE "onboarding_profiles" ("user_id" uuid NOT NULL, "persona" character varying NOT NULL, "deliverable_type" character varying NOT NULL, "due_date" date NOT NULL, "academic_level" character varying NOT NULL, "school_name" character varying(120), "work_tools" text array NOT NULL, "blockers" text array NOT NULL, "acquisition_channel" character varying NOT NULL, "marketing_opt_in" boolean NOT NULL DEFAULT false, "marketing_opt_in_at" TIMESTAMP WITH TIME ZONE NOT NULL, "submitted_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c56dd404bb94e735c0515298c30" PRIMARY KEY ("user_id"))`,
    );

    await queryRunner.query(
      `ALTER TABLE "lead_scores" ADD CONSTRAINT "FK_lead_scores_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "lead_signals" ADD CONSTRAINT "FK_lead_signals_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "onboarding_profiles" ADD CONSTRAINT "FK_onboarding_profiles_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // Users who connected a tool before this feature shipped already earn the
    // `connected_tool` rule (3 points, still `cold`).
    await queryRunner.query(
      `INSERT INTO "lead_scores" ("user_id", "score", "tier", "breakdown", "computed_at")
       SELECT DISTINCT c."user_id", 3, 'cold', '[{"rule":"connected_tool","points":3}]'::jsonb, now()
       FROM "connector_connections" c JOIN "users" u ON u."id" = c."user_id"
       WHERE c."status" = 'active'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "onboarding_profiles" DROP CONSTRAINT "FK_onboarding_profiles_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lead_signals" DROP CONSTRAINT "FK_lead_signals_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lead_scores" DROP CONSTRAINT "FK_lead_scores_user_id"`,
    );
    await queryRunner.query(`DROP TABLE "onboarding_profiles"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_lead_signals_user_type"`);
    await queryRunner.query(`DROP TABLE "lead_signals"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4f3acfd14f80575381fcb71fc0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d2c4665a80e6900f42a91e92e6"`,
    );
    await queryRunner.query(`DROP TABLE "lead_scores"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "created_at"`);
  }
}
