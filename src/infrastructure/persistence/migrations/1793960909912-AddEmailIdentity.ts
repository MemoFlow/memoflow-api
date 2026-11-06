import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Email identity (see docs/database-schema.md):
 *  - `users.email` becomes canonical (trimmed, lowercase) with a CHECK.
 *  - `users.email_verified_at` (existing rows backfilled to now) and
 *    `users.token_version`.
 *  - New `auth_tokens` table for password-reset / email-verification tokens.
 *
 * Generated via `migration:generate` against a scratch database with all
 * earlier migrations applied, then pruned to the DDL for these changes
 * (TypeORM's Postgres introspection also proposed dropping and re-adding
 * unrelated FK/CHECK constraints, which is reordering noise, same as in
 * AddUserDisabledAt) and extended with the data steps below.
 *
 * Accounts are never merged: if two emails collide once lowercased, the
 * migration aborts before changing anything and lists the row ids.
 */
export class AddEmailIdentity1793960909912 implements MigrationInterface {
  name = 'AddEmailIdentity1793960909912';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const collisions: Array<{ ids: string[] }> = await queryRunner.query(
      `SELECT array_agg("id"::text ORDER BY "id") AS ids
         FROM "users"
        GROUP BY lower(btrim("email"))
       HAVING count(*) > 1`,
    );
    if (collisions.length > 0) {
      const groups = collisions.map((row) => row.ids.join(', '));
      throw new Error(
        `Cannot normalize user emails: ${collisions.length} group(s) of rows collide after lowercasing. ` +
          `Resolve them manually (row ids per group): ${groups.join(' | ')}`,
      );
    }

    await queryRunner.query(
      `UPDATE "users" SET "email" = lower(btrim("email")) WHERE "email" <> lower(btrim("email"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_email_lowercase" CHECK ("email" = lower("email"))`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" ADD "email_verified_at" TIMESTAMP WITH TIME ZONE`,
    );
    // Accounts that exist before verification shipped count as verified.
    await queryRunner.query(`UPDATE "users" SET "email_verified_at" = now()`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "token_version" integer NOT NULL DEFAULT '0'`,
    );

    await queryRunner.query(
      `CREATE TABLE "auth_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "type" character varying NOT NULL, "token_hash" character varying NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_3a94cfa1eada85ac2bf6f3016b7" UNIQUE ("token_hash"), CONSTRAINT "CHK_auth_tokens_type" CHECK ("type" IN ('password_reset', 'email_verification')), CONSTRAINT "PK_41e9ddfbb32da18c4e85e45c2fd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9691367d446cd8b18f462c191b" ON "auth_tokens"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_auth_tokens_user_type_created" ON "auth_tokens"  ("user_id", "type", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_tokens" ADD CONSTRAINT "FK_9691367d446cd8b18f462c191b3" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth_tokens" DROP CONSTRAINT "FK_9691367d446cd8b18f462c191b3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_auth_tokens_user_type_created"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9691367d446cd8b18f462c191b"`,
    );
    await queryRunner.query(`DROP TABLE "auth_tokens"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "token_version"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "email_verified_at"`,
    );
    // Lowercased emails are left as they are: the original casing is not kept.
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_email_lowercase"`,
    );
  }
}
