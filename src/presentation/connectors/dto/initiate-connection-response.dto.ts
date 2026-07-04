import { ApiProperty } from '@nestjs/swagger';
import { ConnectorStatus } from '../../../domain/connectors/connector-status';

export class InitiateConnectionResponseDto {
  @ApiProperty({
    description: "Composio's hosted connect URL to redirect the user to.",
  })
  redirect_url: string;

  @ApiProperty({ description: 'Id of the `connector_connections` row.' })
  connection_id: string;

  @ApiProperty({ enum: ConnectorStatus })
  status: ConnectorStatus;
}
