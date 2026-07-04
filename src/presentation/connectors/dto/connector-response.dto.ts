import { ApiProperty } from '@nestjs/swagger';
import { ConnectorConnection } from '../../../domain/connectors/connector-connection.entity';
import { ConnectorProvider } from '../../../domain/connectors/connector-provider';
import { ConnectorStatus } from '../../../domain/connectors/connector-status';

/**
 * Response DTO for `connector_connections`. Composio holds the actual
 * provider token — this API never has one to leak, and deliberately omits
 * even the internal `composioAccountId` reference from the response.
 */
export class ConnectorResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ConnectorProvider })
  provider: ConnectorProvider;

  @ApiProperty({ enum: ConnectorStatus })
  status: ConnectorStatus;

  @ApiProperty({ nullable: true })
  connected_at: Date | null;

  @ApiProperty()
  created_at: Date;

  static fromDomain(connection: ConnectorConnection): ConnectorResponseDto {
    const dto = new ConnectorResponseDto();
    dto.id = connection.id;
    dto.provider = connection.provider;
    dto.status = connection.status;
    dto.connected_at = connection.connectedAt;
    dto.created_at = connection.createdAt;
    return dto;
  }
}
