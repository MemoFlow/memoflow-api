import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTemplateDto } from './create-template.dto';
import { UpdateTemplateDto } from './update-template.dto';

const validPayload = {
  title: 'Standard Blog Post',
  docType: 'blog',
  scope: 'personal',
  sections: [
    { title: 'Intro', order: 0, wordCountMin: 20, wordCountMax: 100 },
    { title: 'Body', order: 1, wordCountMin: 100, wordCountMax: 500 },
  ],
};

describe('CreateTemplateDto validation', () => {
  it('accepts a well-formed payload', async () => {
    const dto = plainToInstance(CreateTemplateDto, validPayload);
    const errors = await validate(dto);

    expect(errors).toEqual([]);
  });

  it('rejects a section with wordCountMin greater than wordCountMax', async () => {
    const dto = plainToInstance(CreateTemplateDto, {
      ...validPayload,
      sections: [
        { title: 'Intro', order: 0, wordCountMin: 100, wordCountMax: 20 },
      ],
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    // errors[0] is the `sections` array property; children[0] is the
    // section at index 0; its own children hold the per-field errors.
    const sectionErrors =
      errors[0].children?.[0]?.children?.[0]?.constraints ?? {};
    expect(sectionErrors).toHaveProperty('wordCountRangeValid');
  });

  it('rejects duplicate order values within sections', async () => {
    const dto = plainToInstance(CreateTemplateDto, {
      ...validPayload,
      sections: [
        { title: 'Intro', order: 0, wordCountMin: 20, wordCountMax: 100 },
        { title: 'Body', order: 0, wordCountMin: 100, wordCountMax: 500 },
      ],
    });
    const errors = await validate(dto);

    const sectionsError = errors.find((e) => e.property === 'sections');
    expect(sectionsError?.constraints).toHaveProperty('uniqueSectionOrders');
  });
});

describe('UpdateTemplateDto validation', () => {
  it('accepts an empty patch (all fields optional)', async () => {
    const dto = plainToInstance(UpdateTemplateDto, {});
    const errors = await validate(dto);

    expect(errors).toEqual([]);
  });

  it('rejects a wholesale sections replacement with wordCountMin greater than wordCountMax', async () => {
    const dto = plainToInstance(UpdateTemplateDto, {
      sections: [
        { title: 'Intro', order: 0, wordCountMin: 100, wordCountMax: 20 },
      ],
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    const sectionErrors =
      errors[0].children?.[0]?.children?.[0]?.constraints ?? {};
    expect(sectionErrors).toHaveProperty('wordCountRangeValid');
  });

  it('rejects a wholesale sections replacement with duplicate order values', async () => {
    const dto = plainToInstance(UpdateTemplateDto, {
      sections: [
        { title: 'Intro', order: 0, wordCountMin: 20, wordCountMax: 100 },
        { title: 'Body', order: 0, wordCountMin: 100, wordCountMax: 500 },
      ],
    });
    const errors = await validate(dto);

    const sectionsError = errors.find((e) => e.property === 'sections');
    expect(sectionsError?.constraints).toHaveProperty('uniqueSectionOrders');
  });
});

describe('section keyPoints / guidance validation', () => {
  const withSection = (extra: Record<string, unknown>) => ({
    ...validPayload,
    sections: [
      { title: 'Intro', order: 0, wordCountMin: 1, wordCountMax: 2, ...extra },
    ],
  });
  const errorsFor = (cls: typeof CreateTemplateDto, extra: object) =>
    validate(plainToInstance(cls, withSection(extra as never)));

  it.each([CreateTemplateDto, UpdateTemplateDto])(
    '%p accepts good values at the limits',
    async (cls) => {
      expect(
        await errorsFor(cls, {
          keyPoints: Array.from({ length: 50 }, () => 'x'.repeat(2000)),
          guidance: 'g'.repeat(5000),
        }),
      ).toEqual([]);
    },
  );

  it('accepts omitted values', async () => {
    expect(await errorsFor(CreateTemplateDto, {})).toEqual([]);
  });

  it.each([
    ['too many key points', { keyPoints: Array(51).fill('x') }],
    ['an over-long key point', { keyPoints: ['x'.repeat(2001)] }],
    ['a non-string key point', { keyPoints: [1] }],
    ['non-array key points', { keyPoints: 'x' }],
    ['over-long guidance', { guidance: 'g'.repeat(5001) }],
    ['non-string guidance', { guidance: 5 }],
  ])('rejects %s', async (_name, extra) => {
    expect(await errorsFor(CreateTemplateDto, extra)).not.toEqual([]);
    expect(await errorsFor(UpdateTemplateDto, extra)).not.toEqual([]);
  });

  it('accepts every template in the starter content file', async () => {
    const templates = JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          '../../../../docs/plans/2026-11-06-template-content.json',
        ),
        'utf8',
      ),
    ) as object[];
    expect(templates).toHaveLength(5);
    for (const template of templates) {
      expect(
        await validate(plainToInstance(CreateTemplateDto, template)),
      ).toEqual([]);
    }
  });
});
