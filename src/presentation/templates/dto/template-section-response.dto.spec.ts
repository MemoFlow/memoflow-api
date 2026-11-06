import { TemplateSection } from '../../../domain/templates/template-section.entity';
import { TemplateSectionResponseDto } from './template-section-response.dto';

const props = {
  id: 's1',
  templateId: 't1',
  title: 'Intro',
  order: 0,
  wordCountMin: 1,
  wordCountMax: 2,
  isRequired: true,
};

describe('TemplateSectionResponseDto.fromEntity', () => {
  it('maps keyPoints and guidance to snake_case', () => {
    const dto = TemplateSectionResponseDto.fromEntity(
      new TemplateSection({ ...props, keyPoints: ['a'], guidance: 'g' }),
    );
    expect(dto).toMatchObject({ key_points: ['a'], guidance: 'g' });
  });

  it('returns null for absent values', () => {
    const dto = TemplateSectionResponseDto.fromEntity(
      new TemplateSection({ ...props, keyPoints: null, guidance: null }),
    );
    expect(dto.key_points).toBeNull();
    expect(dto.guidance).toBeNull();
  });
});
