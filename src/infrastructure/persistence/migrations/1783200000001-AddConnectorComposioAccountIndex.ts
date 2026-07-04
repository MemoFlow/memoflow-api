import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `findByComposioAccountId` (`ConnectorConnectionTypeOrmRepository`) is on
 * the hot path of every authenticated `POST /connectors/webhook` delivery —
 * `composio_account_id` was left unindexed in `CreateConnectorConnections`,
 * so this ships the index as its own follow-up migration.
 *
 * Index name matches what TypeORM's default naming strategy generates for
 * `@Index()` on `ConnectorConnectionOrmEntity.composioAccountId`
 * (`IDX_` + sha1("connector_connections_composio_account_id").slice(0, 26)),
 * so a future `migration:generate` diff sees no drift between the entity
 * metadata and the schema this migration produces.
 */
export class AddConnectorComposioAccountIndex1783200000001 implements MigrationInterface {
  name = 'AddConnectorComposioAccountIndex1783200000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_570d203a0b7c80a516ad3febd6" ON "connector_connections" ("composio_account_id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_570d203a0b7c80a516ad3febd6"`,
    );
  }
}
