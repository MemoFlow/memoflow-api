import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { makeLeadRow } from '../../../../test/utils/leads-fakes';
import { LeadTier } from '../../../domain/leads/lead-enums';
import { computeLeadStats } from '../../../domain/leads/lead-stats';
import { LeadStatsResponseDto } from './lead-stats-response.dto';
import { LeadSummaryResponseDto } from './lead-summary-response.dto';
import { ListLeadsQueryDto } from './list-leads-query.dto';

const parse = (plain: object) =>
  plainToInstance(ListLeadsQueryDto, plain, {
    enableImplicitConversion: true,
  });

describe('ListLeadsQueryDto', () => {
  it('accepts exact true/false strings and keeps them as strings', async () => {
    const dto = parse({
      marketing_opt_in: 'false',
      onboarding_completed: 'true',
    });
    expect(await validate(dto, { whitelist: true })).toHaveLength(0);
    expect(dto.marketing_opt_in).toBe('false');
  });

  it.each([
    { marketing_opt_in: 'abc' },
    { onboarding_completed: '1' },
    { page: 'x' },
    { limit: '1.5' },
    { tier: 'lukewarm' },
  ])('rejects %j', async (query) => {
    expect(await validate(parse(query), { whitelist: true })).not.toHaveLength(
      0,
    );
  });

  it('does not reject out-of-range page and limit', async () => {
    const dto = parse({ page: '-4', limit: '9999' });
    expect(await validate(dto, { whitelist: true })).toHaveLength(0);
  });
});

describe('LeadSummaryResponseDto', () => {
  it('derives suggested_action from current opt-in and maps snake_case', () => {
    const base = makeLeadRow({ tier: LeadTier.Hot, score: 9 });
    expect(
      LeadSummaryResponseDto.fromRow({ ...base, marketingOptIn: true })
        .suggested_action,
    ).toBe('interview_and_pro_offer');
    const dto = LeadSummaryResponseDto.fromRow(base);
    expect(dto.suggested_action).toBe('no_outreach');
    expect(dto.score_computed_at).toBeNull();
    expect(dto.registered_at).toBe('2026-01-01T00:00:00.000Z');
    expect(Object.keys(dto)).not.toContain('breakdown');
  });
});

describe('LeadStatsResponseDto', () => {
  it('maps camelCase stats to the contract keys', () => {
    const stats = computeLeadStats(
      [makeLeadRow()],
      new Date('2026-11-06T12:00:00Z'),
    );
    const dto = LeadStatsResponseDto.fromStats(stats);
    expect(Object.keys(dto).sort()).toEqual(
      [
        'generated_at',
        'total_leads',
        'tiers',
        'suggested_actions',
        'onboarding',
        'marketing_opt_in',
        'connected_tool',
        'signals',
        'distributions',
      ].sort(),
    );
    expect(dto.onboarding).toEqual({ not_started: 1, completed: 0 });
    expect(Object.keys(dto.distributions).sort()).toEqual(
      [
        'academic_level',
        'acquisition_channel',
        'blockers',
        'deliverable_type',
        'persona',
        'work_tools',
      ].sort(),
    );
  });
});
