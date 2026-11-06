import { Inject, Injectable } from '@nestjs/common';
import { LeadTier } from '../../domain/leads/lead-enums';
import { LEAD_READ_REPOSITORY } from '../../domain/leads/lead-read.repository';
import type {
  LeadReadRepository,
  LeadRow,
} from '../../domain/leads/lead-read.repository';
import { toUtcDate } from '../../domain/leads/lead-score';

export const DEFAULT_LEADS_LIMIT = 25;
export const MAX_LEADS_LIMIT = 100;
// Keeps `(page - 1) * limit` far inside PostgreSQL's bigint OFFSET range.
export const MAX_LEADS_PAGE = 1_000_000_000;

export interface ListLeadsInput {
  tier?: LeadTier;
  onboardingCompleted?: boolean;
  marketingOptIn?: boolean;
  page?: number;
  limit?: number;
}

export interface ListLeadsResult {
  items: LeadRow[];
  total: number;
  page: number;
  limit: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** Paged lead list; out-of-range page and limit are clamped, not rejected. */
@Injectable()
export class ListLeadsUseCase {
  constructor(
    @Inject(LEAD_READ_REPOSITORY)
    private readonly leads: LeadReadRepository,
  ) {}

  async execute(
    input: ListLeadsInput,
    now = new Date(),
  ): Promise<ListLeadsResult> {
    const page = clamp(input.page ?? 1, 1, MAX_LEADS_PAGE);
    const limit = clamp(input.limit ?? DEFAULT_LEADS_LIMIT, 1, MAX_LEADS_LIMIT);
    const { rows, total } = await this.leads.list(
      {
        tier: input.tier,
        onboardingCompleted: input.onboardingCompleted,
        marketingOptIn: input.marketingOptIn,
        page,
        limit,
      },
      toUtcDate(now),
    );
    return { items: rows, total, page, limit };
  }
}
