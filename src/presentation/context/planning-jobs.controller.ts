import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AiQuotaThrottledException } from '../../application/ai/ai-quota-http';
import { GetPlanningJobUseCase } from '../../application/context/get-planning-job.use-case';
import { SubmitPlanningJobUseCase } from '../../application/context/submit-planning-job.use-case';
import { User } from '../../domain/users/user.entity';
import { AiConsentGuard } from '../auth/ai-consent.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { EmailVerifiedGuard } from '../auth/email-verified.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlanningJobResponseDto } from './dto/planning-job-response.dto';
import { SubmitPlanningJobDto } from './dto/submit-planning-job.dto';

@ApiTags('planning-jobs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, EmailVerifiedGuard)
@Controller('planning-jobs')
export class PlanningJobsController {
  constructor(
    private readonly submitPlanningJobUseCase: SubmitPlanningJobUseCase,
    private readonly getPlanningJobUseCase: GetPlanningJobUseCase,
  ) {}

  // Submitting a planning job enqueues LLM + context-engine work, so cap it
  // tighter than the global default — 10/min per user IP.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(AiConsentGuard)
  @Post()
  @HttpCode(202)
  @ApiOperation({ summary: 'Submit a planning job for async processing' })
  @ApiResponse({ status: 202, type: PlanningJobResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'Invalid body, e.g. prompt empty or over 5000 characters, or a connector that is not one of your active connections',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description:
      'AI consent missing or for an older notice (error: AI_CONSENT_REQUIRED), or email not verified',
  })
  @ApiResponse({
    status: 404,
    description:
      'documentId/sectionId given but not found (or not owned by the caller)',
  })
  @ApiResponse({
    status: 429,
    description:
      'Daily AI usage limit reached (per user or in total); see the Retry-After header (seconds until the next UTC midnight)',
  })
  @ApiResponse({
    status: 503,
    description:
      'Failed to enqueue the job for processing, or the AI usage counters are unreachable',
  })
  async submit(
    @CurrentUser() user: User,
    @Body() dto: SubmitPlanningJobDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PlanningJobResponseDto> {
    let job: Awaited<ReturnType<SubmitPlanningJobUseCase['execute']>>;
    try {
      job = await this.submitPlanningJobUseCase.execute({
        userId: user.id,
        prompt: dto.prompt,
        connectors: dto.connectors,
        documentId: dto.documentId,
        sectionId: dto.sectionId,
      });
    } catch (err) {
      if (err instanceof AiQuotaThrottledException) {
        res.setHeader('Retry-After', String(err.retryAfterSeconds));
      }
      throw err;
    }
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
