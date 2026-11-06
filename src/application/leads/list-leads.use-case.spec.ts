import {
  InMemoryLeadReadRepository,
  makeLeadRow,
} from '../../../test/utils/leads-fakes';
import {
  ListLeadsUseCase,
  MAX_LEADS_LIMIT,
  MAX_LEADS_PAGE,
} from './list-leads.use-case';

describe('ListLeadsUseCase', () => {
  let repo: InMemoryLeadReadRepository;
  let useCase: ListLeadsUseCase;

  beforeEach(() => {
    repo = new InMemoryLeadReadRepository();
    repo.rows = [makeLeadRow({ userId: 'a' }), makeLeadRow({ userId: 'b' })];
    useCase = new ListLeadsUseCase(repo);
  });

  it('applies defaults page 1, limit 25', async () => {
    const result = await useCase.execute({});
    expect(result).toMatchObject({ page: 1, limit: 25, total: 2 });
    expect(result.items).toHaveLength(2);
  });

  it('clamps page below 1 and limit outside 1..100, returning applied values', async () => {
    await expect(
      useCase.execute({ page: -3, limit: 0 }),
    ).resolves.toMatchObject({ page: 1, limit: 1 });
    await expect(
      useCase.execute({ page: 2, limit: 5000 }),
    ).resolves.toMatchObject({ page: 2, limit: MAX_LEADS_LIMIT });
    await expect(useCase.execute({ page: 1e300 })).resolves.toMatchObject({
      page: MAX_LEADS_PAGE,
    });
  });

  it('returns empty items for a page past the end', async () => {
    const result = await useCase.execute({ page: 9 });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(2);
  });

  it('passes filters through, keeping explicit false', async () => {
    await useCase.execute(
      { marketingOptIn: false, onboardingCompleted: true },
      new Date('2026-11-06T23:59:59Z'),
    );
    expect(repo.lastFilter).toMatchObject({
      marketingOptIn: false,
      onboardingCompleted: true,
    });
    expect(repo.lastToday).toBe('2026-11-06');
  });
});
