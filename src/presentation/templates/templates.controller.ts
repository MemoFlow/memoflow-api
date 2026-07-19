import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { ApplyTemplateUseCase } from '../../application/templates/apply-template.use-case';
import { CreateTemplateUseCase } from '../../application/templates/create-template.use-case';
import { DeleteTemplateUseCase } from '../../application/templates/delete-template.use-case';
import { GetTemplateUseCase } from '../../application/templates/get-template.use-case';
import { ListTemplatesUseCase } from '../../application/templates/list-templates.use-case';
import { UpdateTemplateUseCase } from '../../application/templates/update-template.use-case';
import { User } from '../../domain/users/user.entity';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApplyTemplateDto } from './dto/apply-template.dto';
import { ApplyTemplateResponseDto } from './dto/apply-template-response.dto';
import { CreateTemplateDto } from './dto/create-template.dto';
import { ListTemplatesQueryDto } from './dto/list-templates-query.dto';
import { TemplateResponseDto } from './dto/template-response.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';

@ApiTags('templates')
@Controller('templates')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TemplatesController {
  constructor(
    private readonly createTemplateUseCase: CreateTemplateUseCase,
    private readonly listTemplatesUseCase: ListTemplatesUseCase,
    private readonly getTemplateUseCase: GetTemplateUseCase,
    private readonly updateTemplateUseCase: UpdateTemplateUseCase,
    private readonly deleteTemplateUseCase: DeleteTemplateUseCase,
    private readonly applyTemplateUseCase: ApplyTemplateUseCase,
  ) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a template' })
  @ApiResponse({ status: 201, type: TemplateResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(
    @CurrentUser() user: User,
    @Body() dto: CreateTemplateDto,
  ): Promise<TemplateResponseDto> {
    const template = await this.createTemplateUseCase.execute({
      userId: user.id,
      title: dto.title,
      docType: dto.docType,
      scope: dto.scope,
      styleConfig: dto.styleConfig,
      isPublished: dto.isPublished,
      sections: dto.sections,
    });
    return TemplateResponseDto.fromEntity(template);
  }

  @Get()
  @ApiOperation({
    summary: 'List templates visible to the current user (published or own)',
  })
  @ApiResponse({ status: 200, type: [TemplateResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async list(
    @CurrentUser() user: User,
    @Query() query: ListTemplatesQueryDto,
  ): Promise<TemplateResponseDto[]> {
    const templates = await this.listTemplatesUseCase.execute({
      userId: user.id,
      docType: query.docType,
      scope: query.scope,
    });
    return templates.map((template) =>
      TemplateResponseDto.fromEntity(template),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a template by id (published or own)' })
  @ApiResponse({ status: 200, type: TemplateResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async getById(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TemplateResponseDto> {
    const template = await this.getTemplateUseCase.execute({
      userId: user.id,
      templateId: id,
    });
    return TemplateResponseDto.fromEntity(template);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Update a template (owner-scoped; sections replace wholesale when provided)',
  })
  @ApiResponse({ status: 200, type: TemplateResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateDto,
  ): Promise<TemplateResponseDto> {
    const template = await this.updateTemplateUseCase.execute({
      userId: user.id,
      templateId: id,
      patch: dto,
    });
    return TemplateResponseDto.fromEntity(template);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a template (owner-scoped)' })
  @ApiResponse({ status: 204, description: 'Template deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async delete(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.deleteTemplateUseCase.execute({
      userId: user.id,
      templateId: id,
    });
  }

  @Post(':id/apply')
  @HttpCode(201)
  @ApiOperation({
    summary:
      'Apply a template to a document, appending one section per template section',
  })
  @ApiResponse({ status: 201, type: ApplyTemplateResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 404,
    description: 'Template or document not found',
  })
  async apply(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyTemplateDto,
  ): Promise<ApplyTemplateResponseDto> {
    const result = await this.applyTemplateUseCase.execute({
      userId: user.id,
      templateId: id,
      documentId: dto.documentId,
    });
    return ApplyTemplateResponseDto.fromResult(result);
  }
}
