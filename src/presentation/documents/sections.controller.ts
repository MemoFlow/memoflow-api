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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CreateSectionUseCase } from '../../application/documents/create-section.use-case';
import { DeleteSectionUseCase } from '../../application/documents/delete-section.use-case';
import { GetSectionUseCase } from '../../application/documents/get-section.use-case';
import { ListSectionsUseCase } from '../../application/documents/list-sections.use-case';
import { ReorderSectionsUseCase } from '../../application/documents/reorder-sections.use-case';
import { UpdateSectionUseCase } from '../../application/documents/update-section.use-case';
import { User } from '../../domain/users/user.entity';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateSectionDto } from './dto/create-section.dto';
import { ReorderSectionsDto } from './dto/reorder-sections.dto';
import { SectionResponseDto } from './dto/section-response.dto';
import { UpdateSectionDto } from './dto/update-section.dto';

@ApiTags('sections')
@Controller('documents/:documentId/sections')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SectionsController {
  constructor(
    private readonly createSectionUseCase: CreateSectionUseCase,
    private readonly listSectionsUseCase: ListSectionsUseCase,
    private readonly getSectionUseCase: GetSectionUseCase,
    private readonly updateSectionUseCase: UpdateSectionUseCase,
    private readonly deleteSectionUseCase: DeleteSectionUseCase,
    private readonly reorderSectionsUseCase: ReorderSectionsUseCase,
  ) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a section within a document' })
  @ApiResponse({ status: 201, type: SectionResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async create(
    @CurrentUser() user: User,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: CreateSectionDto,
  ): Promise<SectionResponseDto> {
    const section = await this.createSectionUseCase.execute({
      userId: user.id,
      documentId,
      title: dto.title,
      content: dto.content,
      status: dto.status,
    });
    return SectionResponseDto.fromEntity(section);
  }

  @Get()
  @ApiOperation({ summary: "List a document's sections, ordered" })
  @ApiResponse({ status: 200, type: [SectionResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async list(
    @CurrentUser() user: User,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<SectionResponseDto[]> {
    const sections = await this.listSectionsUseCase.execute({
      userId: user.id,
      documentId,
    });
    return sections.map((section) => SectionResponseDto.fromEntity(section));
  }

  // Declared before ':id' routes so 'reorder' isn't swallowed by the
  // ':id' param route.
  @Patch('reorder')
  @ApiOperation({ summary: "Reorder a document's sections" })
  @ApiResponse({ status: 200, type: [SectionResponseDto] })
  @ApiResponse({ status: 400, description: 'sectionIds mismatch' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async reorder(
    @CurrentUser() user: User,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: ReorderSectionsDto,
  ): Promise<SectionResponseDto[]> {
    const sections = await this.reorderSectionsUseCase.execute({
      userId: user.id,
      documentId,
      sectionIds: dto.sectionIds,
    });
    return sections.map((section) => SectionResponseDto.fromEntity(section));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a section by id (owner-scoped)' })
  @ApiResponse({ status: 200, type: SectionResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Section not found' })
  async getById(
    @CurrentUser() user: User,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SectionResponseDto> {
    const section = await this.getSectionUseCase.execute({
      userId: user.id,
      documentId,
      sectionId: id,
    });
    return SectionResponseDto.fromEntity(section);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a section (owner-scoped)' })
  @ApiResponse({ status: 200, type: SectionResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Section not found' })
  async update(
    @CurrentUser() user: User,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSectionDto,
  ): Promise<SectionResponseDto> {
    const section = await this.updateSectionUseCase.execute({
      userId: user.id,
      documentId,
      sectionId: id,
      patch: dto,
    });
    return SectionResponseDto.fromEntity(section);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a section (owner-scoped)' })
  @ApiResponse({ status: 204, description: 'Section deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Section not found' })
  async delete(
    @CurrentUser() user: User,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.deleteSectionUseCase.execute({
      userId: user.id,
      documentId,
      sectionId: id,
    });
  }
}
