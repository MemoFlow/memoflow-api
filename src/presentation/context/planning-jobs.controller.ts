import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { GetPlanningJobUseCase } from '../../application/context/get-planning-job.use-case';
import { SubmitPlanningJobUseCase } from '../../application/context/submit-planning-job.use-case';
import { User } from '../../domain/users/user.entity';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlanningJobResponseDto } from './dto/planning-job-response.dto';
import { SubmitPlanningJobDto } from './dto/submit-planning-job.dto';

@ApiTags('planning-jobs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('planning-jobs')
export class PlanningJobsController {
  constructor(
    private readonly submitPlanningJobUseCase: SubmitPlanningJobUseCase,
    private readonly getPlanningJobUseCase: GetPlanningJobUseCase,
  ) {}

  @Post()
  @HttpCode(202)
  @ApiOperation({ summary: 'Submit a planning job for async processing' })
  @ApiResponse({ status: 202, type: PlanningJobResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 503,
    description: 'Failed to enqueue the job for processing',
  })
  async submit(
    @CurrentUser() user: User,
    @Body() dto: SubmitPlanningJobDto,
  ): Promise<PlanningJobResponseDto> {
    const job = await this.submitPlanningJobUseCase.execute({
      userId: user.id,
      prompt: dto.prompt,
      connectors: dto.connectors,
    });
    return PlanningJobResponseDto.fromDomain(job);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a planning job by id (REST fallback)' })
  @ApiResponse({ status: 200, type: PlanningJobResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Planning job not found' })
  async getById(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<PlanningJobResponseDto> {
    const job = await this.getPlanningJobUseCase.execute({
      jobId: id,
      userId: user.id,
    });
    return PlanningJobResponseDto.fromDomain(job);
  }
}
