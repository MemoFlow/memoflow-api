import { LeadSignalType } from './lead-enums';
import { LeadSignal } from './lead-signal.entity';

export const LEAD_SIGNAL_REPOSITORY = Symbol('LeadSignalRepository');

export interface LeadSignalRepository {
  /**
   * Keeps one row per (user, type): creates it, or bumps `occurrences` and
   * `last_seen_at`.
   */
  record(userId: string, type: LeadSignalType, now: Date): Promise<void>;
  findByUserId(userId: string): Promise<LeadSignal[]>;
}
