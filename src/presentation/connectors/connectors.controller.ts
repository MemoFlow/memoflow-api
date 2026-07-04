import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { GetConnectionUseCase } from '../../application/connectors/get-connection.use-case';
import { InitiateConnectionUseCase } from '../../application/connectors/initiate-connection.use-case';
import { ListConnectionsUseCase } from '../../application/connectors/list-connections.use-case';
import { ConnectorProvider } from '../../domain/connectors/connector-provider';
import { User } from '../../domain/users/user.entity';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ConnectorResponseDto } from './dto/connector-response.dto';
import { InitiateConnectionResponseDto } from './dto/initiate-connection-response.dto';

@ApiTags('connectors')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('connectors')
export class ConnectorsController {
  constructor(
    private readonly initiateConnectionUseCase: InitiateConnectionUseCase,
    private readonly listConnectionsUseCase: ListConnectionsUseCase,
    private readonly getConnectionUseCase: GetConnectionUseCase,
  ) {}

  @Post(':provider/connect')
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
}
