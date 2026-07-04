import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GetConnectionUseCase } from './application/connectors/get-connection.use-case';
import { InitiateConnectionUseCase } from './application/connectors/initiate-connection.use-case';
import { ListConnectionsUseCase } from './application/connectors/list-connections.use-case';
import { CONNECTOR_CONNECTION_REPOSITORY } from './domain/connectors/connector-connection.repository';
import { CONNECTOR_GATEWAY } from './domain/connectors/connector-gateway.port';
import { ComposioGateway } from './infrastructure/connectors/composio.gateway';
import { ConnectorConnectionOrmEntity } from './infrastructure/persistence/connectors/connector-connection.orm-entity';
import { ConnectorConnectionTypeOrmRepository } from './infrastructure/persistence/connectors/connector-connection.typeorm.repository';
import { ConnectorsController } from './presentation/connectors/connectors.controller';
import { UsersModule } from './users.module';

/**
 * Branch: feature/connector-connections (roadmap item 7, branch 1) —
 * Composio-backed connector connection references (PG). Never stores raw
 * provider tokens; Composio is the token vault.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ConnectorConnectionOrmEntity]),
    // JwtAuthGuard/JwtStrategy live in UsersModule, mirrored from
    // ContextModule's import for the same reason.
    UsersModule,
  ],
  controllers: [ConnectorsController],
  providers: [
    {
      provide: CONNECTOR_CONNECTION_REPOSITORY,
      useClass: ConnectorConnectionTypeOrmRepository,
    },
    { provide: CONNECTOR_GATEWAY, useClass: ComposioGateway },
    InitiateConnectionUseCase,
    ListConnectionsUseCase,
    GetConnectionUseCase,
  ],
  exports: [CONNECTOR_CONNECTION_REPOSITORY],
})
export class ConnectorsModule {}
