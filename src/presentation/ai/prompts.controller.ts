import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ActivatePromptUseCase } from '../../application/ai/activate-prompt.use-case';
import { CreatePromptUseCase } from '../../application/ai/create-prompt.use-case';
import { ListPromptsUseCase } from '../../application/ai/list-prompts.use-case';
import { UserRole } from '../../domain/users/user-role';
import { User } from '../../domain/users/user.entity';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreatePromptDto } from './dto/create-prompt.dto';
import { ListPromptsQueryDto } from './dto/list-prompts-query.dto';
import { PromptResponseDto } from './dto/prompt-response.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Admin)
@Controller('admin/prompts')
export class PromptsController {
  constructor(
    private readonly listPromptsUseCase: ListPromptsUseCase,
    private readonly createPromptUseCase: CreatePromptUseCase,
    private readonly activatePromptUseCase: ActivatePromptUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List prompts (admin only)' })
  @ApiResponse({ status: 200, type: [PromptResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async list(
    @Query() query: ListPromptsQueryDto,
  ): Promise<PromptResponseDto[]> {
    const prompts = await this.listPromptsUseCase.execute({
      featureType: query.feature_type,
    });
    return prompts.map((prompt) => PromptResponseDto.fromDomain(prompt));
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create an inactive prompt version (admin only)',
    description:
      'The new prompt is inactive; call `POST /admin/prompts/{id}/activate` to put it live.',
  })
  @ApiResponse({ status: 201, type: PromptResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'Invalid body, unknown feature type, disallowed placeholder, or user_template missing its required placeholder',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({
    status: 409,
    description: 'This feature type already has this version',
  })
  async create(
    @CurrentUser() admin: User,
    @Body() dto: CreatePromptDto,
  ): Promise<PromptResponseDto> {
    const prompt = await this.createPromptUseCase.execute({
      actorId: admin.id,
      featureType: dto.feature_type,
      version: dto.version,
      systemTemplate: dto.system_template,
      userTemplate: dto.user_template,
    });
    return PromptResponseDto.fromDomain(prompt);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Make a prompt the active one for its feature type (admin only)',
  })
  @ApiResponse({ status: 200, type: PromptResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({ status: 404, description: 'Prompt not found' })
  @ApiResponse({
    status: 409,
    description: 'A concurrent activation conflicted; retry',
  })
  async activate(
    @CurrentUser() admin: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PromptResponseDto> {
    const prompt = await this.activatePromptUseCase.execute({
      actorId: admin.id,
      promptId: id,
    });
    return PromptResponseDto.fromDomain(prompt);
  }
}
