import { JobStatus, PlanningJob } from '../../domain/context/planning-job';
import {
  runClaimedPlanning,
  RunClaimedPlanningDeps,
} from './run-claimed-planning';

describe('runClaimedPlanning', () => {
  const claimed = { id: 'job-1', userId: 'user-1' } as PlanningJob;

  it('fails the job instead of leaving it in planning when the prompt lookup throws', async () => {
    const updateStatus = jest.fn((_id: string, patch: object) =>
      Promise.resolve({ ...claimed, ...patch }),
    );
    const plan = jest.fn();
    const deps = {
      planningJobRepository: { updateStatus },
      planningPipeline: { prepare: jest.fn(), plan },
      promptRepository: {
        findActiveByFeatureType: () =>
          Promise.reject(new Error('database unavailable')),
      },
      userRepository: { findById: jest.fn() },
      logger: { error: jest.fn() },
    } as unknown as RunClaimedPlanningDeps;

    const job = await runClaimedPlanning(deps, claimed, {});

    expect(job.status).toBe(JobStatus.Failed);
    expect(job.errorMessage).not.toContain('database unavailable');
    expect(job.promptVersion).toBeNull();
    expect(plan).not.toHaveBeenCalled();
    expect(updateStatus).toHaveBeenCalledTimes(1);
  });
});
