import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { GetConnectionUseCase } from '../../application/connectors/get-connection.use-case';
import { InitiateConnectionUseCase } from '../../application/connectors/initiate-connection.use-case';
import { ListConnectionsUseCase } from '../../application/connectors/list-connections.use-case';
import { RevokeConnectionUseCase } from '../../application/connectors/revoke-connection.use-case';
import { SyncConnectionStatusUseCase } from '../../application/connectors/sync-connection-status.use-case';
import { ConnectorProvider } from '../../domain/connectors/connector-provider';
import { User } from '../../domain/users/user.entity';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ConnectorResponseDto } from './dto/connector-response.dto';
import { InitiateConnectionResponseDto } from './dto/initiate-connection-response.dto';

@ApiTags('connectors')
@Controller('connectors')
export class ConnectorsController {
  constructor(
    private readonly initiateConnectionUseCase: InitiateConnectionUseCase,
    private readonly listConnectionsUseCase: ListConnectionsUseCase,
    private readonly getConnectionUseCase: GetConnectionUseCase,
    private readonly revokeConnectionUseCase: RevokeConnectionUseCase,
    private readonly syncConnectionStatusUseCase: SyncConnectionStatusUseCase,
  ) {}

  /**
   * Public — Composio, not an app user, calls this. Signature verification
   * (webhook-id/webhook-timestamp/webhook-signature headers, HMAC-SHA256
   * via `@composio/core`) is the auth here instead of the JWT guard, so it
   * deliberately sits outside `@UseGuards(JwtAuthGuard)` (applied per-method
   * on the other routes below, not at the class level).
   */
  @Post('webhook')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async webhook(
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ received: boolean }> {
    const rawBody = req.rawBody;
    const id = req.headers['webhook-id'];
    const timestamp = req.headers['webhook-timestamp'];
    const signature = req.headers['webhook-signature'];
    if (
      !rawBody ||
      typeof id !== 'string' ||
      typeof timestamp !== 'string' ||
      typeof signature !== 'string'
    ) {
      throw new UnauthorizedException(
        'Missing Composio webhook signature headers',
      );
    }

    await this.syncConnectionStatusUseCase.verifyAndApply(rawBody, {
      id,
      timestamp,
      signature,
    });
    return { received: true };
  }

  @Post(':provider/connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(201)
  @ApiParam({ name: 'provider', enum: ConnectorProvider })
  @ApiOperation({ summary: 'Start a Composio connect flow for a provider' })
  @ApiResponse({ status: 201, type: InitiateConnectionResponseDto })
  @ApiResponse({ status: 400, description: 'Unknown provider' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 503,
    description: 'Composio failed to create a connect link',
  })
  async connect(
    @CurrentUser() user: User,
    @Param('provider', new ParseEnumPipe(ConnectorProvider))
    provider: ConnectorProvider,
  ): Promise<InitiateConnectionResponseDto> {
    const result = await this.initiateConnectionUseCase.execute({
      userId: user.id,
      provider,
    });
    const dto = new InitiateConnectionResponseDto();
    dto.redirect_url = result.redirectUrl;
    dto.connection_id = result.connectionId;
    dto.status = result.status;
    return dto;
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the current user's connector connections" })
  @ApiResponse({ status: 200, type: [ConnectorResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async list(@CurrentUser() user: User): Promise<ConnectorResponseDto[]> {
    const connections = await this.listConnectionsUseCase.execute(user.id);
    return connections.map((connection) =>
      ConnectorResponseDto.fromDomain(connection),
    );
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a connector connection by id (owner-scoped)' })
  @ApiResponse({ status: 200, type: ConnectorResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Connector connection not found' })
  async getById(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConnectorResponseDto> {
    const connection = await this.getConnectionUseCase.execute({
      connectionId: id,
      userId: user.id,
    });
    return ConnectorResponseDto.fromDomain(connection);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a connector connection (owner-scoped)' })
  @ApiResponse({ status: 204, description: 'Connection revoked' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Connector connection not found' })
  async revoke(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.revokeConnectionUseCase.execute({
      connectionId: id,
      userId: user.id,
    });
  }
}
