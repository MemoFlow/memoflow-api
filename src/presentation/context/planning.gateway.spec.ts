import { Logger, NotFoundException } from '@nestjs/common';
import { JobStatus, PlanningJob } from '../../domain/context/planning-job';
import { UserRole } from '../../domain/users/user-role';
import { User } from '../../domain/users/user.entity';
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

function makeUser(disabledAt: Date | null = null, tokenVersion = 0): User {
  return new User({
    id: 'user-1',
    email: 'a@b.com',
    passwordHash: 'hash',
    displayName: 'A',
    role: UserRole.User,
    xp: 0,
    level: 1,
    lastActiveAt: null,
    disabledAt,
    tokenVersion,
  });
}

describe('PlanningGateway', () => {
  let jwtService: { verifyAsync: jest.Mock };
  let configService: { getOrThrow: jest.Mock };
  let getUserById: { execute: jest.Mock };
  let getPlanningJob: { execute: jest.Mock };
  let gateway: PlanningGateway;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn() };
    configService = { getOrThrow: jest.fn().mockReturnValue('test-secret') };
    getUserById = { execute: jest.fn().mockResolvedValue(makeUser()) };
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
      getUserById.execute.mockResolvedValue(makeUser());

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

    it('joins the owner room before checking the account, and only then emits ready', async () => {
      const client = makeClient();
      client.handshake.auth.token = 'valid-token';
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      const order: string[] = [];
      client.join.mockImplementation(() => {
        order.push('join');
        return Promise.resolve();
      });
      getUserById.execute.mockImplementation(() => {
        order.push('check');
        return Promise.resolve(makeUser());
      });
      client.emit.mockImplementation((event: string) => {
        order.push(`emit:${event}`);
      });

      await gateway.handleConnection(client as any);

      expect(order).toEqual(['join', 'check', 'emit:ready']);
    });

    it('does not join any room when token verification fails', async () => {
      const client = makeClient();
      client.handshake.auth.token = 'bad';
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid'));
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await gateway.handleConnection(client as any);

      expect(client.join).not.toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects when the account is disabled', async () => {
      const client = makeClient();
      client.handshake.auth.token = 'valid-token';
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      getUserById.execute.mockResolvedValue(
        new User({
          id: 'user-1',
          email: 'a@b.com',
          passwordHash: 'hash',
          displayName: 'A',
          role: UserRole.User,
          xp: 0,
          level: 1,
          lastActiveAt: null,
          disabledAt: new Date(),
        }),
      );

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.emit).not.toHaveBeenCalledWith('ready');
    });

    it('logs a warning (without the token) for a non-auth failure and still disconnects', async () => {
      const client = makeClient();
      client.handshake.auth.token = 'secret-token-value';
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      getUserById.execute.mockRejectedValue(new Error('db down'));
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).not.toContain('secret-token-value');
      warn.mockRestore();
    });

    it('does not log for an invalid token', async () => {
      const client = makeClient();
      client.handshake.auth.token = 'bad';
      const err = new Error('invalid signature');
      err.name = 'JsonWebTokenError';
      jwtService.verifyAsync.mockRejectedValue(err);
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
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
      expect(client.emit).not.toHaveBeenCalledWith('ready');
    });
  });

  describe('session version', () => {
    it('disconnects at handshake when the token version is stale', async () => {
      const client = makeClient();
      client.handshake.auth.token = 'valid-token';
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', tv: 0 });
      getUserById.execute.mockResolvedValue(makeUser(null, 1));

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.emit).not.toHaveBeenCalled();
    });

    it('treats a missing tv as 0 and keeps the version on the socket', async () => {
      const client = makeClient();
      client.handshake.auth.token = 'valid-token';
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      getUserById.execute.mockResolvedValue(makeUser(null, 0));

      await gateway.handleConnection(client as any);

      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.data.tokenVersion).toBe(0);
    });

    it('disconnects on subscribe when the account version moved on', async () => {
      const client = makeClient();
      client.data.userId = 'user-1';
      client.data.tokenVersion = 0;
      getUserById.execute.mockResolvedValue(makeUser(null, 1));

      await gateway.handleSubscribe(client as any, { jobId: 'job-1' });

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(getPlanningJob.execute).not.toHaveBeenCalled();
    });

    it('drops the sockets of a user whose sessions were revoked', () => {
      const disconnectSockets = jest.fn();
      const inRoom = jest.fn().mockReturnValue({ disconnectSockets });
      gateway.server = { in: inRoom } as any;

      gateway.handleUserSessionsRevoked({ userId: 'user-1' });

      expect(inRoom).toHaveBeenCalledWith('user:user-1');
      expect(disconnectSockets).toHaveBeenCalledWith(true);
    });
  });

  describe('handleUserDisabled', () => {
    it("disconnects every socket in the user's room", () => {
      const disconnectSockets = jest.fn();
      const inRoom = jest.fn().mockReturnValue({ disconnectSockets });
      gateway.server = { in: inRoom } as any;

      gateway.handleUserDisabled({ userId: 'user-1' });

      expect(inRoom).toHaveBeenCalledWith('user:user-1');
      expect(disconnectSockets).toHaveBeenCalledWith(true);
    });
  });

  describe('handleSubscribe', () => {
    it('disconnects without serving the job when the account is now disabled', async () => {
      const client = makeClient();
      client.data.userId = 'user-1';
      getUserById.execute.mockResolvedValue(makeUser(new Date()));

      await gateway.handleSubscribe(client as any, { jobId: 'job-1' });

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(getPlanningJob.execute).not.toHaveBeenCalled();
    });

    it('fails closed (disconnects and rethrows) when the account re-check errors', async () => {
      const client = makeClient();
      client.data.userId = 'user-1';
      const boom = new Error('db down');
      getUserById.execute.mockRejectedValue(boom);

      await expect(
        gateway.handleSubscribe(client as any, { jobId: 'job-1' }),
      ).rejects.toBe(boom);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(getPlanningJob.execute).not.toHaveBeenCalled();
    });

    it('disconnects without serving the job when the user no longer exists', async () => {
      const client = makeClient();
      client.data.userId = 'user-1';
      getUserById.execute.mockRejectedValue(new NotFoundException());

      await gateway.handleSubscribe(client as any, { jobId: 'job-1' });

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(getPlanningJob.execute).not.toHaveBeenCalled();
    });

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
