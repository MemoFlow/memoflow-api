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

@Injectable()
export class PromptTypeOrmRepository implements PromptRepository {
  constructor(
    @InjectRepository(PromptOrmEntity)
    private readonly repository: Repository<PromptOrmEntity>,
  ) {}

  async findActiveByFeatureType(featureType: string): Promise<Prompt | null> {
    const entity = await this.repository.findOne({
      where: { featureType, isActive: true },
    });
    return entity ? this.toDomain(entity) : null;
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
      return await this.repository.manager.transaction(async (manager) => {
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
      });
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
