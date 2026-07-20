import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Security-hardening plan, slice 5 — `audit_logs` (PG, write-only internal
 * sink; no controller). `user_id` has no plain single-column index —
 * `IDX_audit_logs_user_created` (composite `(user_id, created_at DESC)`,
 * db-mentor's recommendation) covers both the FK lookup and "events for a
 * user, newest first" without a redundant second index. TypeORM's `@Index`
 * decorator has no per-column sort-order option, so this hand-tunes the
 * generated `CREATE INDEX` to add `DESC` on `created_at` — a deliberate
 * diff against what a straight `migration:generate` would emit from
 * `AuditLogOrmEntity`'s decorators (ascending), but TypeORM's Postgres
 * schema introspection does not compare index column sort order when
 * diffing, only the column list, so a future `migration:generate` run
 * against this table still sees no drift.
 *
 * `user_id`'s FK to `users` is hand-added (`AuditLogOrmEntity` declares it
 * as a plain `uuid` column, not a `@ManyToOne` relation — same convention
 * `templates.created_by` uses) with `ON DELETE SET NULL`: the audit trail
 * must outlive a deleted user, so a deleted account's past events are kept,
 * just anonymised rather than cascaded away.
 *
 * The rest of this migration was generated via `migration:generate` (which
 * also proposed dropping and re-adding every other table's FK/CHECK
 * constraints — TypeORM's Postgres introspection reordering noise, unrelated
 * to this change) and pruned down to only the `audit_logs` DDL.
 */
export class CreateAuditLogs1784541505262 implements MigrationInterface {
  name = 'CreateAuditLogs1784541505262';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // uuid-ossp is already enabled by CreateUsers, but this migration must
    // stand alone (e.g. if run against a fresh DB in isolation).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(
      `CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid, "action" character varying NOT NULL, "metadata" jsonb, "ip" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_user_created" ON "audit_logs" ("user_id", "created_at" DESC) `,
    );

    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_audit_logs_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_audit_logs_user_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_audit_logs_user_created"`,
    );
    await queryRunner.query(`DROP TABLE "audit_logs"`);
  }
}
