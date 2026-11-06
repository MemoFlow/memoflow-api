import { MigrationInterface, QueryRunner } from 'typeorm';
import { PROMPT_DEFINITIONS_V2 } from '../../../domain/ai/prompt-definitions';

// Frozen with this migration: later changes to the live feature-type config
// must not change what it does.
const V2_VERSION = 'v2';
const V2_USER_INVOCABLE: Record<string, boolean> = {
  suggestion: true,
  rewrite: true,
  summarize: true,
  expand: true,
  planning: false,
};
const V2_FEATURE_TYPES = Object.keys(PROMPT_DEFINITIONS_V2);

/**
 * Prompt system (AI rework slice 2): `prompts` gets `system_template` and
 * `user_invocable`, a partial unique index guaranteeing one active prompt per
 * feature type, and a unique `(feature_type, version)`; `ai_suggestions` gets
 * a nullable `model`. All pre-existing prompts are deactivated and the v2
 * prompts (`PROMPT_DEFINITIONS_V2`, frozen) are inserted as the active ones.
 *
 * Generated via `migration:generate` against a scratch database with all
 * earlier migrations applied, then pruned to the prompt/model DDL — TypeORM's
 * Postgres introspection also proposed dropping and re-adding unrelated
 * FK/CHECK constraints, which is reordering noise (same as in
 * AddUserDisabledAt). The plain `is_active` index is dropped: the partial
 * unique index serves the "active prompt for a feature type" lookup.
 */
export class PromptSystem1793974800549 implements MigrationInterface {
  name = 'PromptSystem1793974800549';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "prompts" ADD "system_template" text`);
    await queryRunner.query(
      `ALTER TABLE "prompts" ADD "user_invocable" boolean NOT NULL DEFAULT false`,
    );
    // Backfill legacy rows (all deactivated below): the system line the
    // generator used to hard-code, and invocability per the known types.
    await queryRunner.query(
      `UPDATE "prompts" SET "system_template" = 'You are a writing assistant. Reply only with a JSON object matching the provided schema.'`,
    );
    const invocable = V2_FEATURE_TYPES.filter((t) => V2_USER_INVOCABLE[t]);
    await queryRunner.query(
      `UPDATE "prompts" SET "user_invocable" = true WHERE "feature_type" = ANY($1)`,
      [invocable],
    );
    await queryRunner.query(
      `ALTER TABLE "prompts" ALTER COLUMN "system_template" SET NOT NULL`,
    );

    // Existing rows may violate the new unique indexes (several active per
    // type), so deactivate everything before creating them.
    await queryRunner.query(`UPDATE "prompts" SET "is_active" = false`);
    // The old schema allowed duplicate (feature_type, version) pairs. Keep
    // the newest row of each group and suffix the older ones with their id so
    // nothing is lost and the unique index can be created.
    await queryRunner.query(
      `UPDATE "prompts" SET "version" = "version" || '-dup-' || "id"::text
       WHERE "id" IN (
         SELECT "id" FROM (
           SELECT "id", ROW_NUMBER() OVER (
             PARTITION BY "feature_type", "version"
             ORDER BY "created_at" DESC, "id" DESC
           ) AS rn FROM "prompts"
         ) ranked WHERE rn > 1
       )`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b06ad86d9493a46bcbecb8cb45"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_prompts_feature_type_version" ON "prompts" ("feature_type", "version")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_prompts_active_feature_type" ON "prompts" ("feature_type") WHERE "is_active" = true`,
    );

    for (const featureType of V2_FEATURE_TYPES) {
      const texts =
        PROMPT_DEFINITIONS_V2[
          featureType as keyof typeof PROMPT_DEFINITIONS_V2
        ];
      await queryRunner.query(
        `INSERT INTO "prompts" ("feature_type", "version", "system_template", "template", "user_invocable", "is_active")
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT ("feature_type", "version") DO UPDATE SET
           "system_template" = EXCLUDED."system_template",
           "template" = EXCLUDED."template",
           "user_invocable" = EXCLUDED."user_invocable",
           "is_active" = true,
           "updated_at" = now()`,
        [
          featureType,
          V2_VERSION,
          texts.systemTemplate,
          texts.userTemplate,
          V2_USER_INVOCABLE[featureType],
        ],
      );
    }

    await queryRunner.query(
      `ALTER TABLE "ai_suggestions" ADD "model" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ai_suggestions" DROP COLUMN "model"`);

    await queryRunner.query(
      `DELETE FROM "prompts" WHERE "version" = $1 AND "feature_type" = ANY($2)`,
      [V2_VERSION, V2_FEATURE_TYPES],
    );
    // Reactivate the most recent remaining row of each feature type that
    // has no active prompt left.
    await queryRunner.query(
      `UPDATE "prompts" SET "is_active" = true WHERE "id" IN (
         SELECT DISTINCT ON ("feature_type") "id" FROM "prompts" p
         WHERE NOT EXISTS (
           SELECT 1 FROM "prompts" a
           WHERE a."feature_type" = p."feature_type" AND a."is_active" = true
         )
         ORDER BY "feature_type", "created_at" DESC
       )`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."UQ_prompts_active_feature_type"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_prompts_feature_type_version"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b06ad86d9493a46bcbecb8cb45" ON "prompts" ("is_active")`,
    );
    await queryRunner.query(
      `ALTER TABLE "prompts" DROP COLUMN "user_invocable"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prompts" DROP COLUMN "system_template"`,
    );
  }
}
