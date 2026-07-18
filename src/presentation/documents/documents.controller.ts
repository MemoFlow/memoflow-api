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
import { CreateDocumentUseCase } from '../../application/documents/create-document.use-case';
import { DeleteDocumentUseCase } from '../../application/documents/delete-document.use-case';
import { GetDocumentUseCase } from '../../application/documents/get-document.use-case';
import { ListDocumentsUseCase } from '../../application/documents/list-documents.use-case';
import { UpdateDocumentUseCase } from '../../application/documents/update-document.use-case';
import { User } from '../../domain/users/user.entity';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateDocumentDto } from './dto/create-document.dto';
import { DocumentResponseDto } from './dto/document-response.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';

@ApiTags('documents')
@Controller('documents')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DocumentsController {
  constructor(
    private readonly createDocumentUseCase: CreateDocumentUseCase,
    private readonly listDocumentsUseCase: ListDocumentsUseCase,
    private readonly getDocumentUseCase: GetDocumentUseCase,
    private readonly updateDocumentUseCase: UpdateDocumentUseCase,
    private readonly deleteDocumentUseCase: DeleteDocumentUseCase,
  ) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a document' })
  @ApiResponse({ status: 201, type: DocumentResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(
    @CurrentUser() user: User,
    @Body() dto: CreateDocumentDto,
  ): Promise<DocumentResponseDto> {
    const document = await this.createDocumentUseCase.execute({
      userId: user.id,
      title: dto.title,
      docType: dto.docType,
      status: dto.status,
      styleConfig: dto.styleConfig,
    });
    return DocumentResponseDto.fromEntity(document);
  }

  @Get()
  @ApiOperation({ summary: "List the current user's documents" })
  @ApiResponse({ status: 200, type: [DocumentResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async list(@CurrentUser() user: User): Promise<DocumentResponseDto[]> {
    const documents = await this.listDocumentsUseCase.execute(user.id);
    return documents.map((document) =>
      DocumentResponseDto.fromEntity(document),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a document by id (owner-scoped)' })
  @ApiResponse({ status: 200, type: DocumentResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async getById(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DocumentResponseDto> {
    const document = await this.getDocumentUseCase.execute({
      userId: user.id,
      documentId: id,
    });
    return DocumentResponseDto.fromEntity(document);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a document (owner-scoped)' })
  @ApiResponse({ status: 200, type: DocumentResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentDto,
  ): Promise<DocumentResponseDto> {
    const document = await this.updateDocumentUseCase.execute({
      userId: user.id,
      documentId: id,
      patch: dto,
    });
    return DocumentResponseDto.fromEntity(document);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a document (owner-scoped)' })
  @ApiResponse({ status: 204, description: 'Document deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async delete(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.deleteDocumentUseCase.execute({
      userId: user.id,
      documentId: id,
    });
  }
}
