import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListTemplatesQueryDto } from './list-templates-query.dto';

const check = (query: Record<string, unknown>) =>
  validate(
    plainToInstance(ListTemplatesQueryDto, query, {
      enableImplicitConversion: true,
    }),
  );

describe('ListTemplatesQueryDto', () => {
  it('accepts an empty query (defaults apply downstream)', async () => {
    expect(await check({})).toEqual([]);
  });

  it.each([
    { limit: '1' },
    { limit: '100' },
    { offset: '0' },
    { offset: '100000' },
    { docType: 'thesis', scope: 'org' },
  ])('accepts %p', async (query) => {
    expect(await check(query)).toEqual([]);
  });

  it.each([
    { limit: '0' },
    { limit: '101' },
    { limit: '-1' },
    { limit: '1.5' },
    { limit: 'abc' },
    { offset: '-1' },
    { offset: '100001' },
    { docType: 'filter-blog' },
    { scope: 'nope' },
  ])('rejects %p', async (query) => {
    expect(await check(query)).not.toEqual([]);
  });
});
