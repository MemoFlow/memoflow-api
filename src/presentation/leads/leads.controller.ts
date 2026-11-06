import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { GetLeadStatsUseCase } from '../../application/leads/get-lead-stats.use-case';
import { GetLeadUseCase } from '../../application/leads/get-lead.use-case';
import { ListLeadsUseCase } from '../../application/leads/list-leads.use-case';
import { UserRole } from '../../domain/users/user-role';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { LeadDetailResponseDto } from './dto/lead-detail-response.dto';
import { LeadStatsResponseDto } from './dto/lead-stats-response.dto';
import {
  LeadListResponseDto,
  LeadSummaryResponseDto,
} from './dto/lead-summary-response.dto';
import { ListLeadsQueryDto } from './dto/list-leads-query.dto';

const toBool = (value: string | undefined): boolean | undefined =>
  value === undefined ? undefined : value === 'true';

@ApiTags('leads')
@Controller('leads')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Admin)
@ApiBearerAuth()
export class LeadsController {
  constructor(
    private readonly listLeads: ListLeadsUseCase,
    private readonly getLeadStats: GetLeadStatsUseCase,
    private readonly getLead: GetLeadUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List leads by stored score (admin only)' })
  @ApiResponse({ status: 200, type: LeadListResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid query' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async list(@Query() query: ListLeadsQueryDto): Promise<LeadListResponseDto> {
    const result = await this.listLeads.execute({
      tier: query.tier,
      onboardingCompleted: toBool(query.onboarding_completed),
      marketingOptIn: toBool(query.marketing_opt_in),
      page: query.page,
      limit: query.limit,
    });
    return {
      items: result.items.map((row) => LeadSummaryResponseDto.fromRow(row)),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }

  // Declared before `:id` so `stats` is not parsed as an id.
  @Get('stats')
  @ApiOperation({ summary: 'Aggregate lead statistics (admin only)' })
  @ApiResponse({ status: 200, type: LeadStatsResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async stats(): Promise<LeadStatsResponseDto> {
    return LeadStatsResponseDto.fromStats(await this.getLeadStats.execute());
  }

  @Get(':id')
  @ApiOperation({ summary: 'Lead detail with score breakdown (admin only)' })
  @ApiResponse({ status: 200, type: LeadDetailResponseDto })
  @ApiResponse({ status: 400, description: 'id is not a uuid' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({ status: 404, description: 'Not a lead' })
  async detail(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeadDetailResponseDto> {
    return LeadDetailResponseDto.fromResult(await this.getLead.execute(id));
  }
}
