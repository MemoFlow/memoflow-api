import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the nullable `ai_consent_at` (timestamptz) and `ai_consent_version`
 * (varchar) columns to `users`. No default and no backfill: existing users
 * read back as null, so they must accept the AI notice before using AI.
 *
 * Generated via `migration:generate` against a scratch database with all
 * earlier migrations applied, then pruned to these two columns — TypeORM's
 * Postgres introspection also proposed dropping and re-adding unrelated
 * FK/CHECK constraints, which is reordering noise (same as in
 * TemplateSectionContent and AddUserDisabledAt).
 */
export class AddUserAiConsent1794000000000 implements MigrationInterface {
  name = 'AddUserAiConsent1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "ai_consent_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "ai_consent_version" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "ai_consent_version"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "ai_consent_at"`);
  }
}
