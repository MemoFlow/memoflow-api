import { JobStatus } from '../../../domain/context/planning-job';
import { PlanningJobMongooseRepository } from './planning-job.mongoose.repository';

function fakeId(hex: string) {
  return { toString: () => hex };
}

function fakeDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: fakeId('507f1f77bcf86cd799439011'),
    user_id: 'user-1',
    document_id: null,
    section_id: null,
    status: JobStatus.Pending,
    prompt: 'Plan my chapter 3',
    connectors: ['notion'],
    result: null,
    error_code: null,
    error_message: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

describe('PlanningJobMongooseRepository', () => {
  describe('create', () => {
    it('maps input data and the created document to the domain entity', async () => {
      const created = fakeDoc();
      const model = { create: jest.fn().mockResolvedValue(created) };
      const repository = new PlanningJobMongooseRepository(model as any);

      const result = await repository.create({
        userId: 'user-1',
        prompt: 'Plan my chapter 3',
        connectors: ['notion'],
      });

      expect(model.create).toHaveBeenCalledWith({
        user_id: 'user-1',
        document_id: null,
        section_id: null,
        prompt: 'Plan my chapter 3',
        connectors: ['notion'],
      });
      expect(result.id).toBe('507f1f77bcf86cd799439011');
      expect(result.userId).toBe('user-1');
      expect(result.status).toBe(JobStatus.Pending);
      expect(result.connectors).toEqual(['notion']);
    });
  });

  describe('findById', () => {
    it('returns the mapped domain entity when found', async () => {
      const found = fakeDoc({ status: JobStatus.Running });
      const exec = jest.fn().mockResolvedValue(found);
      const model = { findById: jest.fn().mockReturnValue({ exec }) };
      const repository = new PlanningJobMongooseRepository(model as any);

      const result = await repository.findById('507f1f77bcf86cd799439011');

      expect(model.findById).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
      expect(result?.status).toBe(JobStatus.Running);
      expect(result?.id).toBe('507f1f77bcf86cd799439011');
    });

    it('returns null when not found', async () => {
      const exec = jest.fn().mockResolvedValue(null);
      const model = { findById: jest.fn().mockReturnValue({ exec }) };
      const repository = new PlanningJobMongooseRepository(model as any);

      const result = await repository.findById('missing-id');

      expect(result).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('translates the patch to snake_case fields and maps the result', async () => {
      const updated = fakeDoc({
        status: JobStatus.Completed,
        result: { outline: ['A', 'B'] },
        finished_at: new Date('2026-01-01T00:05:00.000Z'),
      });
      const exec = jest.fn().mockResolvedValue(updated);
      const model = {
        findByIdAndUpdate: jest.fn().mockReturnValue({ exec }),
      };
      const repository = new PlanningJobMongooseRepository(model as any);

      const result = await repository.updateStatus('507f1f77bcf86cd799439011', {
        status: JobStatus.Completed,
        result: { outline: ['A', 'B'] },
        finishedAt: new Date('2026-01-01T00:05:00.000Z'),
      });

      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011',
        {
          status: JobStatus.Completed,
          result: { outline: ['A', 'B'] },
          finished_at: new Date('2026-01-01T00:05:00.000Z'),
        },
        { new: true },
      );
      expect(result?.status).toBe(JobStatus.Completed);
      expect(result?.result).toEqual({ outline: ['A', 'B'] });
    });

    it('returns null when the job does not exist', async () => {
      const exec = jest.fn().mockResolvedValue(null);
      const model = {
        findByIdAndUpdate: jest.fn().mockReturnValue({ exec }),
      };
      const repository = new PlanningJobMongooseRepository(model as any);

      const result = await repository.updateStatus('missing-id', {
        status: JobStatus.Failed,
        errorCode: 'ENQUEUE_FAILED',
        errorMessage: 'redis unavailable',
      });

      expect(result).toBeNull();
    });
  });
});
