import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  SECTION_CREATED_EVENT,
  SectionCreatedEventPayload,
} from '../../domain/documents/document-events';
import { Section } from '../../domain/documents/section.entity';
import { SECTION_REPOSITORY } from '../../domain/documents/section.repository';
import type { SectionRepository } from '../../domain/documents/section.repository';
import { GetDocumentUseCase } from './get-document.use-case';
import { wordCount } from './word-count';

export interface CreateSectionInput {
  userId: string;
  documentId: string;
  title: string;
  content: string;
  status?: string;
}

@Injectable()
export class CreateSectionUseCase {
  constructor(
    private readonly getDocumentUseCase: GetDocumentUseCase,
    @Inject(SECTION_REPOSITORY)
    private readonly sectionRepository: SectionRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(input: CreateSectionInput): Promise<Section> {
    await this.getDocumentUseCase.execute({
      userId: input.userId,
      documentId: input.documentId,
    });

    // A section's position is always append-on-create; it only ever
    // changes afterwards via `ReorderSectionsUseCase`.
    const maxOrder = await this.sectionRepository.maxOrder(input.documentId);
    const order = (maxOrder ?? -1) + 1;

    const section = await this.sectionRepository.create({
      documentId: input.documentId,
      title: input.title,
      content: input.content,
      order,
      status: input.status ?? 'draft',
      wordCount: wordCount(input.content),
    });

    // Emitted only after the write commits.
    const payload: SectionCreatedEventPayload = {
      userId: input.userId,
      documentId: input.documentId,
      sectionId: section.id,
    };
    this.eventEmitter.emit(SECTION_CREATED_EVENT, payload);

    return section;
  }
}
