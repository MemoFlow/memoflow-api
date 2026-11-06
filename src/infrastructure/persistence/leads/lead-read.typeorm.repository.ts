import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AcademicLevel,
  AcquisitionChannel,
  Blocker,
  DeliverableType,
  LeadTier,
  Persona,
  WorkTool,
} from '../../../domain/leads/lead-enums';
import { ScoreBreakdownEntry } from '../../../domain/leads/lead-score';
import {
  LeadListFilter,
  LeadReadRepository,
  LeadRow,
} from '../../../domain/leads/lead-read.repository';

// Eligible leads: end users only. Missing score rows read as 0 / cold.
const FROM_ELIGIBLE = `
  FROM users u
  LEFT JOIN onboarding_profiles op ON op.user_id = u.id
  LEFT JOIN lead_scores ls ON ls.user_id = u.id
  WHERE u.role = 'user' AND u.disabled_at IS NULL`;

const SELECT_ROW = `
  SELECT u.id AS user_id, u.email, u.display_name,
    COALESCE(ls.score, 0) AS score,
    COALESCE(ls.tier, 'cold') AS tier,
    COALESCE(ls.breakdown, '[]'::jsonb) AS breakdown,
    ls.computed_at AS score_computed_at,
    (op.user_id IS NOT NULL) AS onboarding_completed,
    op.persona, op.deliverable_type,
    to_char(op.due_date, 'YYYY-MM-DD') AS due_date,
    op.academic_level, op.work_tools, op.blockers, op.acquisition_channel,
    COALESCE(op.marketing_opt_in, false) AS marketing_opt_in,
    EXISTS (
      SELECT 1 FROM connector_connections c
      WHERE c.user_id = u.id AND c.status = 'active'
    ) AS has_active_connector,
    EXISTS (
      SELECT 1 FROM lead_signals s
      WHERE s.user_id = u.id AND s.type = 'export_paywall_hit'
    ) AS has_paywall_signal,
    u.created_at AS registered_at, u.last_active_at`;

@Injectable()
export class LeadReadTypeOrmRepository implements LeadReadRepository {
  constructor(private readonly dataSource: DataSource) {}

  async list(
    filter: LeadListFilter,
    today: string,
  ): Promise<{ rows: LeadRow[]; total: number }> {
    const params: unknown[] = [];
    let where = '';
    if (filter.tier !== undefined) {
      params.push(filter.tier);
      where += ` AND COALESCE(ls.tier, 'cold') = $${params.length}`;
    }
    if (filter.onboardingCompleted !== undefined) {
      params.push(filter.onboardingCompleted);
      where += ` AND (op.user_id IS NOT NULL) = $${params.length}`;
    }
    if (filter.marketingOptIn !== undefined) {
      params.push(filter.marketingOptIn);
      where += ` AND COALESCE(op.marketing_opt_in, false) = $${params.length}`;
    }

    const countRows = await this.dataSource.query<{ total: string }[]>(
      `SELECT COUNT(*) AS total ${FROM_ELIGIBLE}${where}`,
      params,
    );

    params.push(today);
    const todayParam = `$${params.length}::date`;
    params.push(filter.limit);
    const limitParam = `$${params.length}`;
    params.push((filter.page - 1) * filter.limit);
    const offsetParam = `$${params.length}`;

    const rows = await this.dataSource.query<Record<string, unknown>[]>(
      `${SELECT_ROW} ${FROM_ELIGIBLE}${where}
       ORDER BY COALESCE(ls.score, 0) DESC,
         (op.due_date >= ${todayParam}) DESC NULLS LAST,
         op.due_date ASC NULLS LAST,
         u.id ASC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params,
    );

    return {
      rows: rows.map((row) => this.toRow(row)),
      total: Number(countRows[0].total),
    };
  }

  async findEligibleByUserId(userId: string): Promise<LeadRow | null> {
    const rows = await this.dataSource.query<Record<string, unknown>[]>(
      `${SELECT_ROW} ${FROM_ELIGIBLE} AND u.id = $1`,
      [userId],
    );
    return rows.length > 0 ? this.toRow(rows[0]) : null;
  }

  async findAllEligible(): Promise<LeadRow[]> {
    const rows = await this.dataSource.query<Record<string, unknown>[]>(
      `${SELECT_ROW} ${FROM_ELIGIBLE}`,
    );
    return rows.map((row) => this.toRow(row));
  }

  private toRow(row: Record<string, unknown>): LeadRow {
    return {
      userId: row.user_id as string,
      email: row.email as string,
      displayName: row.display_name as string,
      score: Number(row.score),
      tier: row.tier as LeadTier,
      breakdown: row.breakdown as ScoreBreakdownEntry[],
      scoreComputedAt: (row.score_computed_at as Date | null) ?? null,
      onboardingCompleted: row.onboarding_completed as boolean,
      persona: (row.persona as Persona | null) ?? null,
      deliverableType: (row.deliverable_type as DeliverableType | null) ?? null,
      dueDate: (row.due_date as string | null) ?? null,
      academicLevel: (row.academic_level as AcademicLevel | null) ?? null,
      workTools: (row.work_tools as WorkTool[] | null) ?? null,
      blockers: (row.blockers as Blocker[] | null) ?? null,
      acquisitionChannel:
        (row.acquisition_channel as AcquisitionChannel | null) ?? null,
      marketingOptIn: row.marketing_opt_in as boolean,
      hasActiveConnector: row.has_active_connector as boolean,
      hasPaywallSignal: row.has_paywall_signal as boolean,
      registeredAt: row.registered_at as Date,
      lastActiveAt: (row.last_active_at as Date | null) ?? null,
    };
  }
}
