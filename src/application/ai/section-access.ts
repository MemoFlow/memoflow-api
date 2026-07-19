import { NotFoundException } from '@nestjs/common';
import { DocumentRepository } from '../../domain/documents/document.repository';
import { Section } from '../../domain/documents/section.entity';
import { SectionRepository } from '../../domain/documents/section.repository';

/**
 * Shared ownership guard for the ai feature: a section is only usable by the
 * user who owns its parent document. Depends on the documents feature only
 * through its exported domain repository interfaces (not its use-cases) —
 * same convention `ApplyTemplateUseCase` documents for templates depending
 * on documents. A missing section and a section whose document belongs to
 * someone else both 404 identically, so existence is never leaked.
 */
export async function assertSectionOwnedByUser(
  sectionRepository: SectionRepository,
  documentRepository: DocumentRepository,
  userId: string,
  sectionId: string,
): Promise<Section> {
  const section = await sectionRepository.findById(sectionId);
  if (!section) {
    throw new NotFoundException(`Section ${sectionId} not found`);
  }

  const document = await documentRepository.findById(section.documentId);
  if (!document || document.userId !== userId) {
    throw new NotFoundException(`Section ${sectionId} not found`);
  }

  return section;
}
