import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the nullable `key_points` (jsonb array of strings) and `guidance`
 * (text) columns to `template_sections`, so the starter templates can carry
 * per-section authoring hints. No default and no backfill: existing rows read
 * back as null.
 *
 * Generated via `migration:generate` against a scratch database with all
 * earlier migrations applied, then pruned to these two columns — TypeORM's
 * Postgres introspection also proposed dropping and re-adding unrelated
 * FK/CHECK constraints, which is reordering noise (same as in
 * AddUserDisabledAt and PromptSystem).
 */
export class TemplateSectionContent1793978999044 implements MigrationInterface {
  name = 'TemplateSectionContent1793978999044';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "template_sections" ADD "key_points" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "template_sections" ADD "guidance" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "template_sections" DROP COLUMN "guidance"`,
    );
    await queryRunner.query(
      `ALTER TABLE "template_sections" DROP COLUMN "key_points"`,
    );
  }
}
