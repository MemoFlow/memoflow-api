import { MigrationInterface, QueryRunner } from 'typeorm';
import { PROMPT_DEFINITIONS_V3 } from '../../../domain/ai/prompt-definitions';

// Frozen with this migration: later changes to the live feature-type config
// must not change what it does.
const PREVIOUS_VERSION = 'v2';
const VERSION = 'v3';
const USER_INVOCABLE: Record<string, boolean> = {
  suggestion: true,
  rewrite: true,
  summarize: true,
  expand: true,
  planning: false,
};
const FEATURE_TYPES = Object.keys(PROMPT_DEFINITIONS_V3);

/**
 * AI rework slice 4: inserts the v3 prompts (`PROMPT_DEFINITIONS_V3`,
 * frozen). Per feature type v3 becomes the active prompt only if the active
 * one is still v2; if an admin has activated anything else, v3 is inserted
 * inactive and the admin's choice stands. A v3 row that already exists for a
 * type (created by hand) is left alone.
 *
 * `down` deletes the v3 rows and puts v2 back as the active prompt wherever
 * v3 was active.
 */
export class PromptsV31793990981000 implements MigrationInterface {
  name = 'PromptsV31793990981000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const featureType of FEATURE_TYPES) {
      const exists = await queryRunner.query(
        `SELECT 1 FROM "prompts" WHERE "feature_type" = $1 AND "version" = $2`,
        [featureType, VERSION],
      );
      if ((exists as unknown[]).length > 0) continue;

      const activeV2 = await queryRunner.query(
        `SELECT 1 FROM "prompts" WHERE "feature_type" = $1 AND "is_active" = true AND "version" = $2`,
        [featureType, PREVIOUS_VERSION],
      );
      const activate = (activeV2 as unknown[]).length > 0;
      if (activate) {
        await queryRunner.query(
          `UPDATE "prompts" SET "is_active" = false, "updated_at" = now() WHERE "feature_type" = $1 AND "is_active" = true`,
          [featureType],
        );
      }
      const texts =
        PROMPT_DEFINITIONS_V3[
          featureType as keyof typeof PROMPT_DEFINITIONS_V3
        ];
      await queryRunner.query(
        `INSERT INTO "prompts" ("feature_type", "version", "system_template", "template", "user_invocable", "is_active")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          featureType,
          VERSION,
          texts.systemTemplate,
          texts.userTemplate,
          USER_INVOCABLE[featureType],
          activate,
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const activeV3 = (await queryRunner.query(
      `SELECT "feature_type" FROM "prompts" WHERE "version" = $1 AND "is_active" = true AND "feature_type" = ANY($2)`,
      [VERSION, FEATURE_TYPES],
    )) as Array<{ feature_type: string }>;
    await queryRunner.query(
      `DELETE FROM "prompts" WHERE "version" = $1 AND "feature_type" = ANY($2)`,
      [VERSION, FEATURE_TYPES],
    );
    await queryRunner.query(
      `UPDATE "prompts" SET "is_active" = true, "updated_at" = now() WHERE "version" = $1 AND "feature_type" = ANY($2)`,
      [PREVIOUS_VERSION, activeV3.map((row) => row.feature_type)],
    );
  }
}
