import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { GetVersionUseCase } from '../../application/document-versions/get-version.use-case';
import { ListVersionsUseCase } from '../../application/document-versions/list-versions.use-case';
import { RestoreVersionUseCase } from '../../application/document-versions/restore-version.use-case';
import { SaveVersionUseCase } from '../../application/document-versions/save-version.use-case';
import { User } from '../../domain/users/user.entity';
import { ParseObjectIdPipe } from '../../shared/pipes/parse-object-id.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RestoreResultDto } from './dto/restore-result.dto';
import { SaveVersionDto } from './dto/save-version.dto';
import { VersionMetadataResponseDto } from './dto/version-metadata-response.dto';
import { VersionResponseDto } from './dto/version-response.dto';

@ApiTags('document-versions')
@Controller('documents/:documentId/versions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DocumentVersionsController {
  constructor(
    private readonly saveVersionUseCase: SaveVersionUseCase,
    private readonly listVersionsUseCase: ListVersionsUseCase,
    private readonly getVersionUseCase: GetVersionUseCase,
    private readonly restoreVersionUseCase: RestoreVersionUseCase,
  ) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: "Save a snapshot of a document's current sections" })
  @ApiResponse({ status: 201, type: VersionResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async save(
    @CurrentUser() user: User,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: SaveVersionDto,
  ): Promise<VersionResponseDto> {
    const version = await this.saveVersionUseCase.execute({
      userId: user.id,
      documentId,
      label: dto.label,
    });
    return VersionResponseDto.fromDomain(version);
  }

  @Get()
  @ApiOperation({
    summary: "List a document's version metadata, newest first",
  })
  @ApiResponse({ status: 200, type: [VersionMetadataResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async list(
    @CurrentUser() user: User,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<VersionMetadataResponseDto[]> {
    const metadata = await this.listVersionsUseCase.execute({
      userId: user.id,
      documentId,
    });
    return metadata.map((m) => VersionMetadataResponseDto.fromDomain(m));
  }

  @Get(':versionId')
  @ApiOperation({ summary: "Get a version's full snapshot" })
  @ApiResponse({ status: 200, type: VersionResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Version not found' })
  async getById(
    @CurrentUser() user: User,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Param('versionId', ParseObjectIdPipe) versionId: string,
  ): Promise<VersionResponseDto> {
    const version = await this.getVersionUseCase.execute({
      userId: user.id,
      documentId,
      versionId,
    });
    return VersionResponseDto.fromDomain(version);
  }

  @Post(':versionId/restore')
  @HttpCode(200)
  @ApiOperation({
    summary: "Restore a document's current sections to a saved snapshot",
  })
  @ApiResponse({ status: 200, type: RestoreResultDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Version not found' })
  async restore(
    @CurrentUser() user: User,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Param('versionId', ParseObjectIdPipe) versionId: string,
  ): Promise<RestoreResultDto> {
    const result = await this.restoreVersionUseCase.execute({
      userId: user.id,
      documentId,
      versionId,
    });
    return RestoreResultDto.fromResult(result);
  }
}
