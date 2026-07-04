import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateConnectorConnections1783200000000 implements MigrationInterface {
  name = 'CreateConnectorConnections1783200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // uuid-ossp is already enabled by CreateUsers, but this migration must
    // stand alone (e.g. if run against a fresh DB in isolation).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(
      `CREATE TABLE "connector_connections" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "provider" character varying NOT NULL, "composio_account_id" character varying, "status" character varying NOT NULL, "connected_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_107932f165f86af81176ae739b9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_90afde6762ff7cb1b556fb131b" ON "connector_connections" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_82b363f33825e734d120283ab8" ON "connector_connections" ("provider") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_425f2c6c2792801007a558c5ae" ON "connector_connections" ("status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_connector_user_provider" ON "connector_connections" ("user_id", "provider") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_connector_user_provider"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_425f2c6c2792801007a558c5ae"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_82b363f33825e734d120283ab8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_90afde6762ff7cb1b556fb131b"`,
    );
    await queryRunner.query(`DROP TABLE "connector_connections"`);
  }
}
