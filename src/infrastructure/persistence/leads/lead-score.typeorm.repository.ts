import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LeadScoreResult } from '../../../domain/leads/lead-score';
import { LeadScoreRepository } from '../../../domain/leads/lead-score.repository';

@Injectable()
export class LeadScoreTypeOrmRepository implements LeadScoreRepository {
  constructor(private readonly dataSource: DataSource) {}

  async saveIfNewer(
    userId: string,
    result: LeadScoreResult,
    computedAt: Date,
  ): Promise<void> {
    // The WHERE on the conflict branch makes a slower, older recalculation a
    // no-op instead of overwriting a newer row.
    await this.dataSource.query(
      `INSERT INTO lead_scores (user_id, score, tier, breakdown, computed_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         score = EXCLUDED.score,
         tier = EXCLUDED.tier,
         breakdown = EXCLUDED.breakdown,
         computed_at = EXCLUDED.computed_at
       WHERE lead_scores.computed_at <= EXCLUDED.computed_at`,
      [
        userId,
        result.score,
        result.tier,
        JSON.stringify(result.breakdown),
        computedAt,
      ],
    );
  }
}
