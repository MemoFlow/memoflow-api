import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Prompt } from '../../../domain/ai/prompt.entity';
import { PromptRepository } from '../../../domain/ai/prompt.repository';
import { PromptOrmEntity } from './prompt.orm-entity';

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

  private toDomain(entity: PromptOrmEntity): Prompt {
    return new Prompt({
      id: entity.id,
      featureType: entity.featureType,
      version: entity.version,
      template: entity.template,
      isActive: entity.isActive,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }
}
