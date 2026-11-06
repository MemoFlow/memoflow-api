import { Inject, Injectable } from '@nestjs/common';
import { LEAD_READ_REPOSITORY } from '../../domain/leads/lead-read.repository';
import type { LeadReadRepository } from '../../domain/leads/lead-read.repository';
import { computeLeadStats, LeadStats } from '../../domain/leads/lead-stats';

@Injectable()
export class GetLeadStatsUseCase {
  constructor(
    @Inject(LEAD_READ_REPOSITORY)
    private readonly leads: LeadReadRepository,
  ) {}

  async execute(now = new Date()): Promise<LeadStats> {
    return computeLeadStats(await this.leads.findAllEligible(), now);
  }
}
