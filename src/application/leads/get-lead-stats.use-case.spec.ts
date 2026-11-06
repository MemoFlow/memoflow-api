import {
  InMemoryLeadReadRepository,
  makeLeadRow,
} from '../../../test/utils/leads-fakes';
import { GetLeadStatsUseCase } from './get-lead-stats.use-case';

describe('GetLeadStatsUseCase', () => {
  it('aggregates every eligible lead', async () => {
    const repo = new InMemoryLeadReadRepository();
    repo.rows = [
      makeLeadRow({ userId: 'a', marketingOptIn: true }),
      makeLeadRow({ userId: 'b' }),
    ];
    const now = new Date('2026-11-06T12:00:00Z');
    const stats = await new GetLeadStatsUseCase(repo).execute(now);
    expect(stats.totalLeads).toBe(2);
    expect(stats.marketingOptIn).toBe(1);
    expect(stats.generatedAt).toBe(now.toISOString());
  });
});
