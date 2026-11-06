import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { GetOnboardingUseCase } from '../../application/leads/get-onboarding.use-case';
import { SubmitOnboardingUseCase } from '../../application/leads/submit-onboarding.use-case';
import { UpdateConsentUseCase } from '../../application/leads/update-consent.use-case';
import { User } from '../../domain/users/user.entity';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OnboardingResponseDto } from './dto/onboarding-response.dto';
import { SubmitOnboardingDto } from './dto/submit-onboarding.dto';
import { UpdateConsentDto } from './dto/update-consent.dto';

@ApiTags('onboarding')
@Controller('onboarding')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class OnboardingController {
  constructor(
    private readonly getOnboarding: GetOnboardingUseCase,
    private readonly submitOnboarding: SubmitOnboardingUseCase,
    private readonly updateConsent: UpdateConsentUseCase,
  ) {}

  @Get('me')
  @ApiOperation({ summary: "Get the current user's onboarding answers" })
  @ApiResponse({ status: 200, type: OnboardingResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMe(@CurrentUser() user: User): Promise<OnboardingResponseDto> {
    return OnboardingResponseDto.fromProfile(
      await this.getOnboarding.execute(user.id),
    );
  }

  @Put('me')
  @ApiOperation({ summary: 'Submit all onboarding answers (replaces them)' })
  @ApiResponse({ status: 200, type: OnboardingResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async submit(
    @CurrentUser() user: User,
    @Body() dto: SubmitOnboardingDto,
  ): Promise<OnboardingResponseDto> {
    const profile = await this.submitOnboarding.execute({
      userId: user.id,
      persona: dto.persona,
      deliverableType: dto.deliverable_type,
      dueDate: dto.due_date,
      academicLevel: dto.academic_level,
      schoolName: dto.school_name ?? null,
      workTools: dto.work_tools,
      blockers: dto.blockers,
      acquisitionChannel: dto.acquisition_channel,
      marketingOptIn: dto.marketing_opt_in,
    });
    return OnboardingResponseDto.fromProfile(profile);
  }

  @Put('me/consent')
  @ApiOperation({ summary: 'Change only the marketing consent choice' })
  @ApiResponse({ status: 200, type: OnboardingResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 409, description: 'Onboarding not submitted yet' })
  async consent(
    @CurrentUser() user: User,
    @Body() dto: UpdateConsentDto,
  ): Promise<OnboardingResponseDto> {
    const profile = await this.updateConsent.execute(
      user.id,
      dto.marketing_opt_in,
    );
    return OnboardingResponseDto.fromProfile(profile);
  }
}
