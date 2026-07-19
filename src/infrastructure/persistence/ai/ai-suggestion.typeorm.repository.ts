import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AiSuggestion,
  SuggestionStatus,
} from '../../../domain/ai/ai-suggestion.entity';
import {
  AiSuggestionRepository,
  CreateAiSuggestionData,
} from '../../../domain/ai/ai-suggestion.repository';
import { AiSuggestionOrmEntity } from './ai-suggestion.orm-entity';

@Injectable()
export class AiSuggestionTypeOrmRepository implements AiSuggestionRepository {
  constructor(
    @InjectRepository(AiSuggestionOrmEntity)
    private readonly repository: Repository<AiSuggestionOrmEntity>,
  ) {}

  async create(data: CreateAiSuggestionData): Promise<AiSuggestion> {
    const entity = this.repository.create({
      sectionId: data.sectionId,
      userId: data.userId,
      featureType: data.featureType,
      originalText: data.originalText,
      suggestedText: data.suggestedText,
      promptVersion: data.promptVersion,
      status: SuggestionStatus.Pending,
    });
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async findById(id: string): Promise<AiSuggestion | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findBySectionId(sectionId: string): Promise<AiSuggestion[]> {
    const entities = await this.repository.find({
      where: { sectionId },
      order: { createdAt: 'DESC' },
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async markReviewed(
    id: string,
    status: SuggestionStatus,
  ): Promise<AiSuggestion | null> {
    // Single conditional UPDATE (`... WHERE id = $1 AND status = 'pending'
    // RETURNING *`) — the WHERE guard is the atomicity boundary: two
    // concurrent reviews of the same suggestion can't both win, unlike a
    // read-then-write (`findById` -> check -> `save`) which races.
    const result = await this.repository
      .createQueryBuilder()
      .update(AiSuggestionOrmEntity)
      .set({ status, updatedAt: () => 'now()' })
      .where('id = :id', { id })
      .andWhere('status = :pendingStatus', {
        pendingStatus: SuggestionStatus.Pending,
      })
      .returning('*')
      .execute();

    const rows = result.raw as Record<string, unknown>[] | undefined;
    if (!rows || rows.length === 0) {
      return null;
    }
    return this.toDomainFromRaw(rows[0]);
  }

  private toDomain(entity: AiSuggestionOrmEntity): AiSuggestion {
    return new AiSuggestion({
      id: entity.id,
      sectionId: entity.sectionId,
      userId: entity.userId,
      featureType: entity.featureType,
      originalText: entity.originalText,
      suggestedText: entity.suggestedText,
      status: entity.status as SuggestionStatus,
      promptVersion: entity.promptVersion,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }

  /**
   * Maps a raw row returned by `.returning('*')` — snake_case DB column
   * names (`section_id`, `user_id`, ...), not the ORM entity's camelCase
   * properties.
   */
  private toDomainFromRaw(row: Record<string, unknown>): AiSuggestion {
    return new AiSuggestion({
      id: row.id as string,
      sectionId: row.section_id as string,
      userId: row.user_id as string,
      featureType: row.feature_type as string,
      originalText: row.original_text as string,
      suggestedText: row.suggested_text as string,
      status: row.status as SuggestionStatus,
      promptVersion: row.prompt_version as string,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    });
  }
}
