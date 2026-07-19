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
