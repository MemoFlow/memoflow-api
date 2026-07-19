import { NotFoundException } from '@nestjs/common';
import { DocumentVersion } from '../../domain/document-versions/document-version.entity';
import { Section } from '../../domain/documents/section.entity';
import {
  ReplaceSectionData,
  SectionRepository,
} from '../../domain/documents/section.repository';
import { GetVersionUseCase } from './get-version.use-case';
import { RestoreVersionUseCase } from './restore-version.use-case';

class StubGetVersionUseCase extends GetVersionUseCase {
  constructor(private readonly result: DocumentVersion | Error) {
    // Never actually calls the repositories — execute() is overridden below.
    super(undefined as never, undefined as never);
  }

  execute(): Promise<DocumentVersion> {
    if (this.result instanceof Error) {
      return Promise.reject(this.result);
    }
    return Promise.resolve(this.result);
  }
}

class InMemorySectionRepository implements SectionRepository {
  public replaceAllCalls: {
    documentId: string;
    sections: ReplaceSectionData[];
  }[] = [];

  create(): Promise<Section> {
    return Promise.reject(new Error('not implemented'));
  }

  findById(): Promise<Section | null> {
    return Promise.reject(new Error('not implemented'));
  }

  findByDocument(): Promise<Section[]> {
    return Promise.reject(new Error('not implemented'));
  }

  update(): Promise<Section> {
    return Promise.reject(new Error('not implemented'));
  }

  delete(): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }

  maxOrder(): Promise<number | null> {
    return Promise.reject(new Error('not implemented'));
  }

  reorder(): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }

  replaceAll(
    documentId: string,
    sections: ReplaceSectionData[],
  ): Promise<number> {
    this.replaceAllCalls.push({ documentId, sections });
    return Promise.resolve(sections.length);
  }
}

function makeVersion(
  overrides: Partial<DocumentVersion> = {},
): DocumentVersion {
  return new DocumentVersion({
    id: 'version-1',
    documentId: 'doc-1',
    userId: 'user-1',
    version: 3,
    label: 'Before rewrite',
    sectionsSnapshot: [
      {
        title: 'Intro',
        content: 'Hello',
        order: 0,
        status: 'draft',
        wordCount: 1,
      },
      {
        title: 'Body',
        content: 'World',
        order: 1,
        status: 'published',
        wordCount: 1,
      },
    ],
    savedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

describe('RestoreVersionUseCase', () => {
  it("delegates the snapshot's sections to replaceAll and reports the counts", async () => {
    const version = makeVersion();
    const getVersionUseCase = new StubGetVersionUseCase(version);
    const sectionRepository = new InMemorySectionRepository();
    const useCase = new RestoreVersionUseCase(
      getVersionUseCase,
      sectionRepository,
    );

    const result = await useCase.execute({
      userId: 'user-1',
      documentId: 'doc-1',
      versionId: 'version-1',
    });

    expect(sectionRepository.replaceAllCalls).toHaveLength(1);
    expect(sectionRepository.replaceAllCalls[0]).toEqual({
      documentId: 'doc-1',
      sections: [
        {
          title: 'Intro',
          content: 'Hello',
          order: 0,
          status: 'draft',
          wordCount: 1,
        },
        {
          title: 'Body',
          content: 'World',
          order: 1,
          status: 'published',
          wordCount: 1,
        },
      ],
    });
    expect(result).toEqual({
      documentId: 'doc-1',
      versionId: 'version-1',
      version: 3,
      sectionsRestored: 2,
    });
  });

  it('restores to an empty section set when the snapshot had none', async () => {
    const version = makeVersion({ sectionsSnapshot: [] });
    const getVersionUseCase = new StubGetVersionUseCase(version);
    const sectionRepository = new InMemorySectionRepository();
    const useCase = new RestoreVersionUseCase(
      getVersionUseCase,
      sectionRepository,
    );

    const result = await useCase.execute({
      userId: 'user-1',
      documentId: 'doc-1',
      versionId: 'version-1',
    });

    expect(sectionRepository.replaceAllCalls[0].sections).toEqual([]);
    expect(result.sectionsRestored).toBe(0);
  });

  it('propagates the NotFoundException from GetVersionUseCase without touching the section repository', async () => {
    const getVersionUseCase = new StubGetVersionUseCase(
      new NotFoundException('Version version-1 not found'),
    );
    const sectionRepository = new InMemorySectionRepository();
    const useCase = new RestoreVersionUseCase(
      getVersionUseCase,
      sectionRepository,
    );

    await expect(
      useCase.execute({
        userId: 'user-1',
        documentId: 'doc-1',
        versionId: 'version-1',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(sectionRepository.replaceAllCalls).toHaveLength(0);
  });
});
