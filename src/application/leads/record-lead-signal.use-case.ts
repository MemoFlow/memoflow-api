import { Inject, Injectable } from '@nestjs/common';
import { LeadSignalType } from '../../domain/leads/lead-enums';
import { LEAD_SIGNAL_REPOSITORY } from '../../domain/leads/lead-signal.repository';
import type { LeadSignalRepository } from '../../domain/leads/lead-signal.repository';
import { UserRole } from '../../domain/users/user-role';
import { RecalculateLeadScoreUseCase } from './recalculate-lead-score.use-case';

export interface RecordLeadSignalInput {
  userId: string;
  role: UserRole;
  type: LeadSignalType;
}

@Injectable()
export class RecordLeadSignalUseCase {
  constructor(
    @Inject(LEAD_SIGNAL_REPOSITORY)
    private readonly signals: LeadSignalRepository,
    private readonly recalculate: RecalculateLeadScoreUseCase,
  ) {}

  async execute(input: RecordLeadSignalInput): Promise<void> {
    // Admins are not leads: accept the call and store nothing.
    if (input.role === UserRole.Admin) return;
    await this.signals.record(input.userId, input.type, new Date());
    await this.recalculate.execute(input.userId);
  }
}
