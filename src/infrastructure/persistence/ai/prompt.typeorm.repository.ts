import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Prompt } from '../../../domain/ai/prompt.entity';
import {
  CreatePromptData,
  PromptActivationConflictError,
  PromptRepository,
  PromptVersionConflictError,
} from '../../../domain/ai/prompt.repository';
import { PromptOrmEntity } from './prompt.orm-entity';

const UNIQUE_VIOLATION = '23505';
const VERSION_UNIQUE_INDEX = 'UQ_prompts_feature_type_version';
const ACTIVE_UNIQUE_INDEX = 'UQ_prompts_active_feature_type';

function isUniqueViolation(err: unknown): err is QueryFailedError {
  return (
    err instanceof QueryFailedError &&
    (err.driverError as { code?: string }).code === UNIQUE_VIOLATION
  );
}

/** How long an active-prompt lookup is reused. Other instances can lag this long. */
export const ACTIVE_PROMPT_CACHE_TTL_MS = 60_000;

interface ActivePromptEntry {
  prompt: Prompt | null;
  expiresAt: number;
}

@Injectable()
export class PromptTypeOrmRepository implements PromptRepository {
  constructor(
    @InjectRepository(PromptOrmEntity)
    private readonly repository: Repository<PromptOrmEntity>,
  ) {}

  /**
   * In-memory, per instance, for 60 seconds, "no active prompt" included.
   * `activate` clears it on this instance; another instance may serve the old
   * prompt for up to the TTL, which is accepted.
   */
  private readonly activeCache = new Map<string, ActivePromptEntry>();
  /** Bumped on every clear, so a read that began before it can't repopulate. */
  private cacheGeneration = 0;

  async findActiveByFeatureType(featureType: string): Promise<Prompt | null> {
    const cached = this.activeCache.get(featureType);
    if (cached && cached.expiresAt > Date.now()) return cached.prompt;

    const generation = this.cacheGeneration;
    const entity = await this.repository.findOne({
      where: { featureType, isActive: true },
    });
    const prompt = entity ? this.toDomain(entity) : null;
    if (generation === this.cacheGeneration) {
      this.activeCache.set(featureType, {
        prompt,
        expiresAt: Date.now() + ACTIVE_PROMPT_CACHE_TTL_MS,
      });
    }
    return prompt;
  }

  async findById(id: string): Promise<Prompt | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async list(featureType?: string): Promise<Prompt[]> {
    const entities = await this.repository.find({
      where: featureType ? { featureType } : {},
      order: { featureType: 'ASC', createdAt: 'DESC' },
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async create(data: CreatePromptData): Promise<Prompt> {
    const entity = this.repository.create({
      featureType: data.featureType,
      version: data.version,
      systemTemplate: data.systemTemplate,
      template: data.template,
      userInvocable: data.userInvocable,
      isActive: false,
    });
    try {
      return this.toDomain(await this.repository.save(entity));
    } catch (err) {
      if (
        isUniqueViolation(err) &&
        (err.driverError as { constraint?: string }).constraint ===
          VERSION_UNIQUE_INDEX
      ) {
        throw new PromptVersionConflictError();
      }
      throw err;
    }
  }

  async activate(id: string): Promise<Prompt | null> {
    try {
      const activated = await this.repository.manager.transaction(
        async (manager) => {
          const prompts = manager.getRepository(PromptOrmEntity);
          const target = await prompts.findOne({ where: { id } });
          if (!target) {
            return null;
          }
          await prompts.update(
            { featureType: target.featureType, isActive: true },
            { isActive: false },
          );
          await prompts.update({ id }, { isActive: true });
          const updated = await prompts.findOneOrFail({ where: { id } });
          return this.toDomain(updated);
        },
      );
      // Cleared only after the commit: a failed or rolled-back activation
      // changed nothing, so the cached prompt is still right.
      if (activated) this.clearActiveCache();
      return activated;
    } catch (err) {
      if (
        isUniqueViolation(err) &&
        (err.driverError as { constraint?: string }).constraint ===
          ACTIVE_UNIQUE_INDEX
      ) {
        throw new PromptActivationConflictError();
      }
      throw err;
    }
  }

  private clearActiveCache(): void {
    this.cacheGeneration += 1;
    this.activeCache.clear();
  }

  private toDomain(entity: PromptOrmEntity): Prompt {
    return new Prompt({
      id: entity.id,
      featureType: entity.featureType,
      version: entity.version,
      systemTemplate: entity.systemTemplate,
      template: entity.template,
      userInvocable: entity.userInvocable,
      isActive: entity.isActive,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }
}
