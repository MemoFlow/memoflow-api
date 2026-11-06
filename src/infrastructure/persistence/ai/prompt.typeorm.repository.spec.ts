import { Repository } from 'typeorm';
import {
  ACTIVE_PROMPT_CACHE_TTL_MS,
  PromptTypeOrmRepository,
} from './prompt.typeorm.repository';
import { PromptOrmEntity } from './prompt.orm-entity';

function makeEntity(version: string, featureType = 'suggestion') {
  return {
    id: `id-${featureType}-${version}`,
    featureType,
    version,
    systemTemplate: 'S',
    template: 'T',
    userInvocable: true,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as PromptOrmEntity;
}

describe('PromptTypeOrmRepository active prompt cache', () => {
  let now: number;
  let findOne: jest.Mock;
  let transaction: jest.Mock;
  let repository: PromptTypeOrmRepository;

  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    findOne = jest.fn();
    transaction = jest.fn();
    repository = new PromptTypeOrmRepository({
      findOne,
      manager: { transaction },
    } as unknown as Repository<PromptOrmEntity>);
  });

  afterEach(() => jest.restoreAllMocks());

  it('reads once and serves the same prompt for 60 seconds', async () => {
    findOne.mockResolvedValue(makeEntity('v1'));

    const first = await repository.findActiveByFeatureType('suggestion');
    now += ACTIVE_PROMPT_CACHE_TTL_MS - 1;
    const second = await repository.findActiveByFeatureType('suggestion');

    expect(first?.version).toBe('v1');
    expect(second).toBe(first);
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it('reads again once the 60 seconds are over', async () => {
    findOne.mockResolvedValueOnce(makeEntity('v1'));
    await repository.findActiveByFeatureType('suggestion');
    now += ACTIVE_PROMPT_CACHE_TTL_MS;
    findOne.mockResolvedValueOnce(makeEntity('v2'));

    const next = await repository.findActiveByFeatureType('suggestion');

    expect(next?.version).toBe('v2');
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  it('caches a missing prompt too', async () => {
    findOne.mockResolvedValue(null);

    expect(await repository.findActiveByFeatureType('nope')).toBeNull();
    expect(await repository.findActiveByFeatureType('nope')).toBeNull();

    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it('keeps feature types apart', async () => {
    findOne.mockImplementation(
      ({ where }: { where: { featureType: string } }) =>
        Promise.resolve(makeEntity('v1', where.featureType)),
    );

    const a = await repository.findActiveByFeatureType('suggestion');
    const b = await repository.findActiveByFeatureType('rewrite');

    expect(a?.featureType).toBe('suggestion');
    expect(b?.featureType).toBe('rewrite');
  });

  it('is cleared when an activation succeeds, so the new prompt applies at once', async () => {
    findOne.mockResolvedValueOnce(makeEntity('v1'));
    await repository.findActiveByFeatureType('suggestion');
    transaction.mockResolvedValue(makeEntityDomainStub());
    await repository.activate('id-suggestion-v2');
    findOne.mockResolvedValueOnce(makeEntity('v2'));

    const after = await repository.findActiveByFeatureType('suggestion');

    expect(after?.version).toBe('v2');
  });

  it('is not cleared by an activation that finds nothing or fails', async () => {
    findOne.mockResolvedValue(makeEntity('v1'));
    await repository.findActiveByFeatureType('suggestion');

    transaction.mockResolvedValueOnce(null);
    await repository.activate('missing');
    transaction.mockRejectedValueOnce(new Error('boom'));
    await expect(repository.activate('x')).rejects.toThrow('boom');
    await repository.findActiveByFeatureType('suggestion');

    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it('does not let a read that began before an activation repopulate the cache with the old prompt', async () => {
    let release!: (value: PromptOrmEntity) => void;
    findOne.mockReturnValueOnce(
      new Promise<PromptOrmEntity>((resolve) => (release = resolve)),
    );
    const inFlight = repository.findActiveByFeatureType('suggestion');

    transaction.mockResolvedValue(makeEntityDomainStub());
    await repository.activate('id-suggestion-v2');
    release(makeEntity('v1'));
    await inFlight;
    findOne.mockResolvedValueOnce(makeEntity('v2'));

    const after = await repository.findActiveByFeatureType('suggestion');

    expect(after?.version).toBe('v2');
  });
});

function makeEntityDomainStub(): unknown {
  return { id: 'id-suggestion-v2' };
}
