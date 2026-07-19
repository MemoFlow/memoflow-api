import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DOCUMENT_REPOSITORY } from '../../domain/documents/document.repository';
import type { DocumentRepository } from '../../domain/documents/document.repository';
import { DOCUMENT_TEMPLATE_REPOSITORY } from '../../domain/templates/document-template.repository';
import type { DocumentTemplateRepository } from '../../domain/templates/document-template.repository';
import { TEMPLATE_REPOSITORY } from '../../domain/templates/template.repository';
import type { TemplateRepository } from '../../domain/templates/template.repository';
import { assertTemplateVisible } from './template-access';

export interface ApplyTemplateInput {
  userId: string;
  templateId: string;
  documentId: string;
}

export interface ApplyTemplateResult {
  documentTemplateId: string;
  documentId: string;
  templateId: string;
  appliedAt: Date;
  sectionsCreated: number;
}

/**
 * Applies a template to a document:
 * 1. the template must be visible to the user (published or own) — else 404;
 * 2. the document must be owned by the user — else 404 (`DocumentRepository`
 *    is injected directly rather than reusing documents' `GetDocumentUseCase`,
 *    to keep this application layer depending only on domain-layer
 *    repository interfaces, per feature, not on another feature's
 *    use-cases);
 * 3. `DocumentTemplateRepository.applyToDocument` performs the actual
 *    writes — one document section per template section (ordered by the
 *    template section's `order`, appended after the document's current
 *    sections) plus the `document_templates` row — atomically, in a single
 *    transaction, so a failure partway through can't orphan sections
 *    without a recorded application.
 */
@Injectable()
export class ApplyTemplateUseCase {
  constructor(
    @Inject(TEMPLATE_REPOSITORY)
    private readonly templateRepository: TemplateRepository,
    @Inject(DOCUMENT_TEMPLATE_REPOSITORY)
    private readonly documentTemplateRepository: DocumentTemplateRepository,
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documentRepository: DocumentRepository,
  ) {}

  async execute(input: ApplyTemplateInput): Promise<ApplyTemplateResult> {
    const template = assertTemplateVisible(
      await this.templateRepository.findById(input.templateId),
      input.userId,
      input.templateId,
    );

    const document = await this.documentRepository.findById(input.documentId);
    if (!document || document.userId !== input.userId) {
      throw new NotFoundException(`Document ${input.documentId} not found`);
    }

    const orderedSections = [...template.sections].sort(
      (a, b) => a.order - b.order,
    );

    const { documentTemplate, sectionsCreated } =
      await this.documentTemplateRepository.applyToDocument({
        documentId: input.documentId,
        templateId: input.templateId,
        appliedAt: new Date(),
        sections: orderedSections.map((section) => ({
          title: section.title,
          content: '',
          status: 'draft',
          wordCount: 0,
        })),
      });

    return {
      documentTemplateId: documentTemplate.id,
      documentId: input.documentId,
      templateId: input.templateId,
      appliedAt: documentTemplate.appliedAt,
      sectionsCreated,
    };
  }
}
