import { NotFoundException } from '@nestjs/common';
import {
  InMemoryActiveConnectors,
  InMemoryLeadReadRepository,
  InMemoryLeadSignalRepository,
  InMemoryOnboardingProfileRepository,
  makeLeadRow,
  makeSubmitData,
} from '../../../test/utils/leads-fakes';
import { ConnectorProvider } from '../../domain/connectors/connector-provider';
import { LeadSignalType } from '../../domain/leads/lead-enums';
import { GetLeadUseCase } from './get-lead.use-case';

describe('GetLeadUseCase', () => {
  let leads: InMemoryLeadReadRepository;
  let profiles: InMemoryOnboardingProfileRepository;
  let connectors: InMemoryActiveConnectors;
  let signals: InMemoryLeadSignalRepository;
  let useCase: GetLeadUseCase;

  beforeEach(() => {
    leads = new InMemoryLeadReadRepository();
    profiles = new InMemoryOnboardingProfileRepository();
    connectors = new InMemoryActiveConnectors();
    signals = new InMemoryLeadSignalRepository();
    useCase = new GetLeadUseCase(leads, profiles, connectors, signals);
  });

  it('404s for a user that is not an eligible lead', async () => {
    await expect(useCase.execute('nobody')).rejects.toThrow(NotFoundException);
  });

  it('returns a never-scored lead with no onboarding, connectors or signals', async () => {
    leads.rows = [makeLeadRow()];
    const result = await useCase.execute('user-1');
    expect(result.lead.score).toBe(0);
    expect(result.lead.breakdown).toEqual([]);
    expect(result.onboarding).toBeNull();
    expect(result.activeConnectors).toEqual([]);
    expect(result.signals).toEqual([]);
  });

  it('assembles onboarding, active connectors and signals', async () => {
    leads.rows = [makeLeadRow()];
    await profiles.upsert(makeSubmitData(), new Date());
    connectors.active.add('user-1');
    await signals.record('user-1', LeadSignalType.ExportPaywallHit, new Date());
    const result = await useCase.execute('user-1');
    expect(result.onboarding?.userId).toBe('user-1');
    expect(result.activeConnectors).toEqual([ConnectorProvider.Trello]);
    expect(result.signals).toHaveLength(1);
  });
});
