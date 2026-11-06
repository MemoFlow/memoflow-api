import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the nullable `users.disabled_at` column and a CHECK constraint limiting
 * `users.role` to the known roles (see docs/database-schema.md).
 *
 * Generated via `migration:generate` against a scratch database with all
 * earlier migrations applied, then pruned to just the column DDL —
 * TypeORM's Postgres introspection also proposed dropping and re-adding
 * unrelated FK/CHECK constraints, which is reordering noise (same as in
 * CreateAuditLogs).
 */
export class AddUserDisabledAt1793957344930 implements MigrationInterface {
  name = 'AddUserDisabledAt1793957344930';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "disabled_at" TIMESTAMP WITH TIME ZONE`,
    );
    // Map any unknown stored role to the least-privileged one so the CHECK
    // can be added to existing data.
    await queryRunner.query(
      `UPDATE "users" SET "role" = 'user' WHERE "role" NOT IN ('user', 'admin')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_role" CHECK ("role" IN ('user', 'admin'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_role"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "disabled_at"`);
  }
}
