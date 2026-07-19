import { Error as MongooseError } from 'mongoose';
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

function castError() {
  return new MongooseError.CastError('ObjectId', 'not-an-object-id', '_id');
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

    it('returns null (not a thrown error) when the id is not a valid ObjectId', async () => {
      const exec = jest.fn().mockRejectedValue(castError());
      const model = { findById: jest.fn().mockReturnValue({ exec }) };
      const repository = new PlanningJobMongooseRepository(model as any);

      const result = await repository.findById('not-an-object-id');

      expect(result).toBeNull();
    });

    it('rethrows a non-CastError failure', async () => {
      const exec = jest.fn().mockRejectedValue(new Error('connection lost'));
      const model = { findById: jest.fn().mockReturnValue({ exec }) };
      const repository = new PlanningJobMongooseRepository(model as any);

      await expect(
        repository.findById('507f1f77bcf86cd799439011'),
      ).rejects.toThrow('connection lost');
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

    it('returns null (not a thrown error) when the id is not a valid ObjectId', async () => {
      const exec = jest.fn().mockRejectedValue(castError());
      const model = {
        findByIdAndUpdate: jest.fn().mockReturnValue({ exec }),
      };
      const repository = new PlanningJobMongooseRepository(model as any);

      const result = await repository.updateStatus('not-an-object-id', {
        status: JobStatus.Failed,
      });

      expect(result).toBeNull();
    });
  });

  describe('claimForProcessing', () => {
    it('atomically claims a pending job, moving it to running', async () => {
      const claimed = fakeDoc({ status: JobStatus.Running });
      const exec = jest.fn().mockResolvedValue(claimed);
      const model = {
        findOneAndUpdate: jest.fn().mockReturnValue({ exec }),
      };
      const repository = new PlanningJobMongooseRepository(model as any);

      const result = await repository.claimForProcessing(
        '507f1f77bcf86cd799439011',
      );

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: '507f1f77bcf86cd799439011', status: JobStatus.Pending },
        { status: JobStatus.Running, started_at: expect.any(Date) },
        { new: true },
      );
      expect(result?.status).toBe(JobStatus.Running);
    });

    it('returns null when the job is not pending (already claimed/terminal)', async () => {
      const exec = jest.fn().mockResolvedValue(null);
      const model = {
        findOneAndUpdate: jest.fn().mockReturnValue({ exec }),
      };
      const repository = new PlanningJobMongooseRepository(model as any);

      const result = await repository.claimForProcessing(
        '507f1f77bcf86cd799439011',
      );

      expect(result).toBeNull();
    });

    it('returns null (not a thrown error) when the id is not a valid ObjectId', async () => {
      const exec = jest.fn().mockRejectedValue(castError());
      const model = {
        findOneAndUpdate: jest.fn().mockReturnValue({ exec }),
      };
      const repository = new PlanningJobMongooseRepository(model as any);

      const result = await repository.claimForProcessing('not-an-object-id');

      expect(result).toBeNull();
    });
  });

  describe('claimForGathering', () => {
    it('atomically claims a pending job, moving it to gathering', async () => {
      const claimed = fakeDoc({ status: JobStatus.Gathering });
      const exec = jest.fn().mockResolvedValue(claimed);
      const model = {
        findOneAndUpdate: jest.fn().mockReturnValue({ exec }),
      };
      const repository = new PlanningJobMongooseRepository(model as any);

      const result = await repository.claimForGathering(
        '507f1f77bcf86cd799439011',
      );

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: '507f1f77bcf86cd799439011', status: JobStatus.Pending },
        { status: JobStatus.Gathering, started_at: expect.any(Date) },
        { new: true },
      );
      expect(result?.status).toBe(JobStatus.Gathering);
    });

    it('returns null when the job is not pending', async () => {
      const exec = jest.fn().mockResolvedValue(null);
      const model = {
        findOneAndUpdate: jest.fn().mockReturnValue({ exec }),
      };
      const repository = new PlanningJobMongooseRepository(model as any);

      const result = await repository.claimForGathering(
        '507f1f77bcf86cd799439011',
      );

      expect(result).toBeNull();
    });
  });

  describe('appendResultChunk', () => {
    it('atomically pushes a data chunk guarded by (job_id, sequence)', async () => {
      const updated = fakeDoc({
        status: JobStatus.Gathering,
        chunk_sequences: [0],
        data_chunks: [
          {
            sequence: 0,
            provider: 'trello',
            content: '{}',
            token_estimate: 42,
          },
        ],
      });
      const exec = jest.fn().mockResolvedValue(updated);
      const model = {
        findOneAndUpdate: jest.fn().mockReturnValue({ exec }),
      };
      const repository = new PlanningJobMongooseRepository(model as any);

      const result = await repository.appendResultChunk(
        '507f1f77bcf86cd799439011',
        {
          sequence: 0,
          type: 'data',
          data: { provider: 'trello', content: '{}', tokenEstimate: 42 },
        },
      );

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: '507f1f77bcf86cd799439011',
          chunk_sequences: { $ne: 0 },
        },
        {
          $push: {
            chunk_sequences: 0,
            data_chunks: {
              sequence: 0,
              provider: 'trello',
              content: '{}',
              token_estimate: 42,
            },
          },
        },
        { new: true },
      );
      expect(result.applied).toBe(true);
      expect(result.job?.dataChunks).toEqual([
        { sequence: 0, provider: 'trello', content: '{}', tokenEstimate: 42 },
      ]);
    });

    it('does not push data_chunks for a status chunk', async () => {
      const updated = fakeDoc({ status: JobStatus.Gathering });
      const exec = jest.fn().mockResolvedValue(updated);
      const model = {
        findOneAndUpdate: jest.fn().mockReturnValue({ exec }),
      };
      const repository = new PlanningJobMongooseRepository(model as any);

      await repository.appendResultChunk('507f1f77bcf86cd799439011', {
        sequence: 1,
        type: 'status',
      });

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: '507f1f77bcf86cd799439011', chunk_sequences: { $ne: 1 } },
        { $push: { chunk_sequences: 1 } },
        { new: true },
      );
    });

    it('returns applied:false and the current job on a duplicate sequence', async () => {
      const findOneAndUpdateExec = jest.fn().mockResolvedValue(null);
      const existing = fakeDoc({
        status: JobStatus.Gathering,
        chunk_sequences: [0],
      });
      const findByIdExec = jest.fn().mockResolvedValue(existing);
      const model = {
        findOneAndUpdate: jest
          .fn()
          .mockReturnValue({ exec: findOneAndUpdateExec }),
        findById: jest.fn().mockReturnValue({ exec: findByIdExec }),
      };
      const repository = new PlanningJobMongooseRepository(model as any);

      const result = await repository.appendResultChunk(
        '507f1f77bcf86cd799439011',
        { sequence: 0, type: 'status' },
      );

      expect(result.applied).toBe(false);
      expect(result.job?.status).toBe(JobStatus.Gathering);
    });

    it('returns applied:false and job:null when the job does not exist at all', async () => {
      const findOneAndUpdateExec = jest.fn().mockResolvedValue(null);
      const findByIdExec = jest.fn().mockResolvedValue(null);
      const model = {
        findOneAndUpdate: jest
          .fn()
          .mockReturnValue({ exec: findOneAndUpdateExec }),
        findById: jest.fn().mockReturnValue({ exec: findByIdExec }),
      };
      const repository = new PlanningJobMongooseRepository(model as any);

      const result = await repository.appendResultChunk('missing-id', {
        sequence: 0,
        type: 'status',
      });

      expect(result.applied).toBe(false);
      expect(result.job).toBeNull();
    });
  });

  describe('claimForPlanning', () => {
    it('atomically claims a gathering job, moving it to planning and recording contextUsed', async () => {
      const claimed = fakeDoc({
        status: JobStatus.Planning,
        context_used: { chunks: [] },
      });
      const exec = jest.fn().mockResolvedValue(claimed);
      const model = { findOneAndUpdate: jest.fn().mockReturnValue({ exec }) };
      const repository = new PlanningJobMongooseRepository(model as any);

      const result = await repository.claimForPlanning(
        '507f1f77bcf86cd799439011',
        { chunks: [] },
      );

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: '507f1f77bcf86cd799439011', status: JobStatus.Gathering },
        { status: JobStatus.Planning, context_used: { chunks: [] } },
        { new: true },
      );
      expect(result?.status).toBe(JobStatus.Planning);
    });

    it('returns null (loses the race) when the job is not gathering', async () => {
      const exec = jest.fn().mockResolvedValue(null);
      const model = { findOneAndUpdate: jest.fn().mockReturnValue({ exec }) };
      const repository = new PlanningJobMongooseRepository(model as any);

      const result = await repository.claimForPlanning(
        '507f1f77bcf86cd799439011',
        {},
      );

      expect(result).toBeNull();
    });
  });

  describe('failIfStillGathering', () => {
    it('atomically fails a gathering job with the given error_code/error_message', async () => {
      const failed = fakeDoc({
        status: JobStatus.Failed,
        error_code: 'CONTEXT_ENGINE_TIMEOUT',
        error_message: 'timed out',
      });
      const exec = jest.fn().mockResolvedValue(failed);
      const model = { findOneAndUpdate: jest.fn().mockReturnValue({ exec }) };
      const repository = new PlanningJobMongooseRepository(model as any);

      const result = await repository.failIfStillGathering(
        '507f1f77bcf86cd799439011',
        { errorCode: 'CONTEXT_ENGINE_TIMEOUT', errorMessage: 'timed out' },
      );

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: '507f1f77bcf86cd799439011', status: JobStatus.Gathering },
        {
          status: JobStatus.Failed,
          error_code: 'CONTEXT_ENGINE_TIMEOUT',
          error_message: 'timed out',
          finished_at: expect.any(Date),
        },
        { new: true },
      );
      expect(result?.status).toBe(JobStatus.Failed);
      expect(result?.errorCode).toBe('CONTEXT_ENGINE_TIMEOUT');
    });

    it('returns null (loses the race) when the job is not gathering — e.g. already completed', async () => {
      const exec = jest.fn().mockResolvedValue(null);
      const model = { findOneAndUpdate: jest.fn().mockReturnValue({ exec }) };
      const repository = new PlanningJobMongooseRepository(model as any);

      const result = await repository.failIfStillGathering(
        '507f1f77bcf86cd799439011',
        { errorCode: 'CONTEXT_ENGINE_TIMEOUT', errorMessage: 'timed out' },
      );

      expect(result).toBeNull();
    });
  });
});
