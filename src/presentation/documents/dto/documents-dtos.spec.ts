import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateDocumentDto } from './create-document.dto';
import { CreateSectionDto } from './create-section.dto';
import { ReorderSectionsDto } from './reorder-sections.dto';
import { UpdateDocumentDto } from './update-document.dto';
import { UpdateSectionDto } from './update-section.dto';

const uuid = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const validDocument = { title: 'Doc', docType: 'planning' };

describe('CreateDocumentDto / UpdateDocumentDto limits', () => {
  it.each([CreateDocumentDto, UpdateDocumentDto])(
    '%p accepts boundary values',
    async (cls) => {
      const dto = plainToInstance(cls, {
        title: 't'.repeat(200),
        docType: 'internship_report',
        status: 's'.repeat(32),
        styleConfig: { blob: 'x'.repeat(10_000) },
      });
      expect(await validate(dto)).toEqual([]);
    },
  );

  it.each([
    ['an over-long title', { title: 't'.repeat(201) }],
    ['an over-long status', { status: 's'.repeat(33) }],
    ['an oversized styleConfig', { styleConfig: { blob: 'x'.repeat(10_300) } }],
    ['an unknown docType', { docType: 'filter-report' }],
    ['a wrongly cased docType', { docType: 'Blog' }],
  ])('rejects %s', async (_name, extra) => {
    for (const cls of [CreateDocumentDto, UpdateDocumentDto]) {
      const errors = await validate(
        plainToInstance(cls, { ...validDocument, ...extra }),
      );
      expect(errors).not.toEqual([]);
    }
  });

  it.each(['blog', 'planning', 'report', 'thesis', 'internship_report'])(
    'accepts docType %s',
    async (docType) => {
      expect(
        await validate(
          plainToInstance(CreateDocumentDto, { title: 'T', docType }),
        ),
      ).toEqual([]);
    },
  );
});

describe('CreateSectionDto / UpdateSectionDto limits', () => {
  it.each([CreateSectionDto, UpdateSectionDto])(
    '%p accepts boundary values',
    async (cls) => {
      const dto = plainToInstance(cls, {
        title: 't'.repeat(200),
        content: 'c'.repeat(100_000),
        status: 's'.repeat(32),
      });
      expect(await validate(dto)).toEqual([]);
    },
  );

  it.each([
    ['an over-long title', { title: 't'.repeat(201) }],
    ['oversize content', { content: 'c'.repeat(100_001) }],
    ['an over-long status', { status: 's'.repeat(33) }],
  ])('rejects %s', async (_name, extra) => {
    for (const cls of [CreateSectionDto, UpdateSectionDto]) {
      const errors = await validate(
        plainToInstance(cls, { title: 'T', content: 'c', ...extra }),
      );
      expect(errors).not.toEqual([]);
    }
  });
});

describe('ReorderSectionsDto limits', () => {
  it('accepts 50 ids and rejects 51', async () => {
    const ids = (n: number) => Array.from({ length: n }, () => uuid);
    expect(
      await validate(
        plainToInstance(ReorderSectionsDto, { sectionIds: ids(50) }),
      ),
    ).toEqual([]);
    expect(
      await validate(
        plainToInstance(ReorderSectionsDto, { sectionIds: ids(51) }),
      ),
    ).not.toEqual([]);
  });
});
