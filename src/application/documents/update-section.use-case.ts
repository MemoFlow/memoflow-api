import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  SECTION_UPDATED_EVENT,
  SectionUpdatedEventPayload,
} from '../../domain/documents/document-events';
import { Section } from '../../domain/documents/section.entity';
import { SECTION_REPOSITORY } from '../../domain/documents/section.repository';
import type { SectionRepository } from '../../domain/documents/section.repository';
import { GetSectionUseCase } from './get-section.use-case';
import { wordCount } from './word-count';

export interface UpdateSectionInput {
  userId: string;
  documentId: string;
  sectionId: string;
  patch: {
    title?: string;
    content?: string;
    status?: string;
  };
}

/**
 * `order` is deliberately absent from the patch shape — a section's
 * position only ever changes via `ReorderSectionsUseCase`, never here.
 */
@Injectable()
export class UpdateSectionUseCase {
  constructor(
    private readonly getSectionUseCase: GetSectionUseCase,
    @Inject(SECTION_REPOSITORY)
    private readonly sectionRepository: SectionRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(input: UpdateSectionInput): Promise<Section> {
    await this.getSectionUseCase.execute({
      userId: input.userId,
      documentId: input.documentId,
      sectionId: input.sectionId,
    });

    const { content, ...rest } = input.patch;
    const patch =
      content !== undefined
        ? { ...rest, content, wordCount: wordCount(content) }
        : rest;

    const section = await this.sectionRepository.update(input.sectionId, patch);

    // Emitted every time (not just when `content` changed) — the
    // gamification listener's `section_goal` rule reads the section's
    // current word count off the payload regardless of what was patched;
    // `awardOnce` on the (user, document, milestone_type) tuple keeps
    // repeated events from double-awarding.
    const payload: SectionUpdatedEventPayload = {
      userId: input.userId,
      documentId: input.documentId,
      sectionId: section.id,
      wordCount: section.wordCount,
    };
    this.eventEmitter.emit(SECTION_UPDATED_EVENT, payload);

    return section;
  }
}
