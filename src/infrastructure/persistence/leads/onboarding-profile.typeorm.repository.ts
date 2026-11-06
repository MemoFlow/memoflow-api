import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AcademicLevel,
  AcquisitionChannel,
  Blocker,
  DeliverableType,
  Persona,
  WorkTool,
} from '../../../domain/leads/lead-enums';
import { OnboardingProfile } from '../../../domain/leads/onboarding-profile.entity';
import {
  OnboardingProfileRepository,
  SubmitOnboardingData,
} from '../../../domain/leads/onboarding-profile.repository';

// `due_date` is formatted in SQL: node-postgres would otherwise parse a
// `date` into a JS Date shifted by the server's time zone.
const COLUMNS = `user_id, persona, deliverable_type,
  to_char(due_date, 'YYYY-MM-DD') AS due_date, academic_level, school_name,
  work_tools, blockers, acquisition_channel, marketing_opt_in,
  marketing_opt_in_at, submitted_at, created_at, updated_at`;

@Injectable()
export class OnboardingProfileTypeOrmRepository implements OnboardingProfileRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findByUserId(userId: string): Promise<OnboardingProfile | null> {
    const rows = await this.dataSource.query<Record<string, unknown>[]>(
      `SELECT ${COLUMNS} FROM onboarding_profiles WHERE user_id = $1`,
      [userId],
    );
    return rows.length > 0 ? this.toDomain(rows[0]) : null;
  }

  async upsert(
    data: SubmitOnboardingData,
    now: Date,
  ): Promise<OnboardingProfile> {
    // `marketing_opt_in_at` moves only on first insert or when the value
    // changes; the CASE reads the stored row, so concurrent submits can't
    // both rewrite it for an unchanged value.
    const rows = await this.dataSource.query<Record<string, unknown>[]>(
      `INSERT INTO onboarding_profiles
         (user_id, persona, deliverable_type, due_date, academic_level,
          school_name, work_tools, blockers, acquisition_channel,
          marketing_opt_in, marketing_opt_in_at, submitted_at, created_at,
          updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $11, $11)
       ON CONFLICT (user_id) DO UPDATE SET
         persona = EXCLUDED.persona,
         deliverable_type = EXCLUDED.deliverable_type,
         due_date = EXCLUDED.due_date,
         academic_level = EXCLUDED.academic_level,
         school_name = EXCLUDED.school_name,
         work_tools = EXCLUDED.work_tools,
         blockers = EXCLUDED.blockers,
         acquisition_channel = EXCLUDED.acquisition_channel,
         marketing_opt_in = EXCLUDED.marketing_opt_in,
         marketing_opt_in_at = CASE
           WHEN onboarding_profiles.marketing_opt_in
                IS DISTINCT FROM EXCLUDED.marketing_opt_in
           THEN EXCLUDED.marketing_opt_in_at
           ELSE onboarding_profiles.marketing_opt_in_at
         END,
         submitted_at = EXCLUDED.submitted_at,
         updated_at = EXCLUDED.updated_at
       RETURNING ${COLUMNS}`,
      [
        data.userId,
        data.persona,
        data.deliverableType,
        data.dueDate,
        data.academicLevel,
        data.schoolName,
        data.workTools,
        data.blockers,
        data.acquisitionChannel,
        data.marketingOptIn,
        now,
      ],
    );
    return this.toDomain(rows[0]);
  }

  async updateConsent(
    userId: string,
    optIn: boolean,
    now: Date,
  ): Promise<OnboardingProfile | null> {
    // Wrapped in a CTE so the driver returns plain rows (a bare UPDATE
    // returns a `[rows, affectedCount]` tuple).
    const rows = await this.dataSource.query<Record<string, unknown>[]>(
      `WITH updated AS (
         UPDATE onboarding_profiles SET
           marketing_opt_in_at = CASE
             WHEN marketing_opt_in IS DISTINCT FROM $2 THEN $3::timestamptz
             ELSE marketing_opt_in_at
           END,
           marketing_opt_in = $2,
           updated_at = $3
         WHERE user_id = $1
         RETURNING *
       )
       SELECT ${COLUMNS} FROM updated`,
      [userId, optIn, now],
    );
    return rows.length > 0 ? this.toDomain(rows[0]) : null;
  }

  private toDomain(row: Record<string, unknown>): OnboardingProfile {
    return new OnboardingProfile({
      userId: row.user_id as string,
      persona: row.persona as Persona,
      deliverableType: row.deliverable_type as DeliverableType,
      dueDate: row.due_date as string,
      academicLevel: row.academic_level as AcademicLevel,
      schoolName: (row.school_name as string | null) ?? null,
      workTools: row.work_tools as WorkTool[],
      blockers: row.blockers as Blocker[],
      acquisitionChannel: row.acquisition_channel as AcquisitionChannel,
      marketingOptIn: row.marketing_opt_in as boolean,
      marketingOptInAt: row.marketing_opt_in_at as Date,
      submittedAt: row.submitted_at as Date,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    });
  }
}
