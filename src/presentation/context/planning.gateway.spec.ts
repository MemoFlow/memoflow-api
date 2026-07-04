import { NotFoundException } from '@nestjs/common';
import { JobStatus, PlanningJob } from '../../domain/context/planning-job';
import { PlanningGateway } from './planning.gateway';

function makeJob(overrides: Partial<PlanningJob> = {}): PlanningJob {
  return new PlanningJob({
    id: 'job-1',
    userId: 'user-1',
    documentId: null,
    sectionId: null,
    status: JobStatus.Pending,
    prompt: 'Plan my chapter',
    connectors: [],
    result: null,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date(),
    startedAt: null,
    finishedAt: null,
    ...overrides,
  });
}

describe('PlanningGateway', () => {
  let jwtService: { verifyAsync: jest.Mock };
  let configService: { getOrThrow: jest.Mock };
  let getUserById: { execute: jest.Mock };
  let getPlanningJob: { execute: jest.Mock };
  let gateway: PlanningGateway;

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn() };
    configService = { getOrThrow: jest.fn().mockReturnValue('test-secret') };
    getUserById = { execute: jest.fn() };
    getPlanningJob = { execute: jest.fn() };
    gateway = new PlanningGateway(
      jwtService as any,
      configService as any,
      getUserById as any,
      getPlanningJob as any,
    );
  });

  function makeClient() {
    return {
      handshake: { auth: {} as Record<string, unknown> },
      data: {} as Record<string, unknown>,
      join: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
      emit: jest.fn(),
    };
  }

  describe('handleConnection', () => {
    it('joins the owner room and stores userId for a valid token + existing user', async () => {
      const client = makeClient();
      client.handshake.auth.token = 'valid-token';
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        email: 'a@b.com',
      });
      getUserById.execute.mockResolvedValue({ id: 'user-1' });

      await gateway.handleConnection(client as any);

      expect(client.data.userId).toBe('user-1');
      expect(client.join).toHaveBeenCalledWith('user:user-1');
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('disconnects when no token is provided', async () => {
      const client = makeClient();

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });

    it('disconnects when the token fails verification', async () => {
      const client = makeClient();
      client.handshake.auth.token = 'bad-token';
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid'));

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('disconnects when the token is valid but the user no longer exists', async () => {
      const client = makeClient();
      client.handshake.auth.token = 'valid-token';
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'ghost-user',
        email: 'a@b.com',
      });
      getUserById.execute.mockRejectedValue(
        new NotFoundException('User ghost-user not found'),
      );

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });
  });

  describe('handleSubscribe', () => {
    it('emits the mapped current-state event for the caller own job', async () => {
      const client = makeClient();
      client.data.userId = 'user-1';
      const job = makeJob({
        status: JobStatus.Completed,
        result: { suggestions: ['x'] },
      });
      getPlanningJob.execute.mockResolvedValue(job);

      await gateway.handleSubscribe(client as any, { jobId: 'job-1' });

      expect(getPlanningJob.execute).toHaveBeenCalledWith({
        jobId: 'job-1',
        userId: 'user-1',
      });
      expect(client.emit).toHaveBeenCalledWith('planning.completed', {
        jobId: 'job-1',
        status: JobStatus.Completed,
        result: { suggestions: ['x'] },
      });
    });

    it("emits planning.error (not the job) for another user's job", async () => {
      const client = makeClient();
      client.data.userId = 'user-2';
      getPlanningJob.execute.mockRejectedValue(
        new NotFoundException('Planning job job-1 not found'),
      );

      await gateway.handleSubscribe(client as any, { jobId: 'job-1' });

      expect(client.emit).toHaveBeenCalledWith('planning.error', {
        jobId: 'job-1',
        message: 'not found',
      });
      expect(client.emit).not.toHaveBeenCalledWith(
        'planning.completed',
        expect.anything(),
      );
    });
  });

  describe('@OnEvent relays', () => {
    it("relays planning.completed to the owner's room with userId stripped", () => {
      const to = jest.fn().mockReturnValue({ emit: jest.fn() });
      (gateway as any).server = { to };

      gateway.handlePlanningCompleted({
        jobId: 'job-1',
        userId: 'user-1',
        status: JobStatus.Completed,
        result: { suggestions: ['x'] },
      });

      expect(to).toHaveBeenCalledWith('user:user-1');
      expect(to.mock.results[0].value.emit).toHaveBeenCalledWith(
        'planning.completed',
        {
          jobId: 'job-1',
          status: JobStatus.Completed,
          result: { suggestions: ['x'] },
        },
      );
    });
  });
});
