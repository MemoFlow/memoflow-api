import { MigrationInterface, QueryRunner } from 'typeorm';

// Frozen with this migration: it must match the generated column's
// expression on `SectionOrmEntity`, which TypeORM compares against.
const SEARCH_VECTOR_EXPRESSION = `setweight(to_tsvector('simple', left(coalesce(title, ''), 1000)), 'A') || setweight(to_tsvector('simple', left(coalesce(content, ''), 100000)), 'B')`;

/**
 * Full-text search over sections (AI rework slice 4): a generated, stored
 * `search_vector` (title weight A, content weight B) with a GIN index.
 * `simple` because documents can be in any language; `left(...)` caps (100000 characters of content, 1000 of title)
 * because a tsvector has a hard size limit and an oversized section would
 * otherwise fail on insert.
 *
 * Generated via `migration:generate` against a scratch database, then pruned
 * to the column/index DDL: TypeORM's Postgres introspection also proposed
 * dropping and re-adding unrelated FK/CHECK constraints (reordering noise,
 * same as in AddUserDisabledAt and PromptSystem). TypeORM records a
 * generated column's expression in `typeorm_metadata` and, without that row,
 * keeps proposing to recreate the column; the table is only ever created by
 * schema sync, so it is created here if absent and the row is inserted with
 * the live database/schema names instead of the generating machine's.
 */
export class SectionSearchVector1793990881738 implements MigrationInterface {
  name = 'SectionSearchVector1793990881738';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sections" ADD "search_vector" tsvector GENERATED ALWAYS AS (${SEARCH_VECTOR_EXPRESSION}) STORED`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "typeorm_metadata" ("type" character varying NOT NULL, "database" character varying, "schema" character varying, "table" character varying, "name" character varying, "value" text)`,
    );
    await queryRunner.query(
      `INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES (current_database(), current_schema(), $1, $2, $3, $4)`,
      [
        'sections',
        'GENERATED_COLUMN',
        'search_vector',
        SEARCH_VECTOR_EXPRESSION,
      ],
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sections_search_vector" ON "sections" USING gin ("search_vector")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_sections_search_vector"`);
    await queryRunner.query(
      `DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "database" = current_database() AND "schema" = current_schema() AND "table" = $3`,
      ['GENERATED_COLUMN', 'search_vector', 'sections'],
    );
    await queryRunner.query(
      `ALTER TABLE "sections" DROP COLUMN "search_vector"`,
    );
  }
}
