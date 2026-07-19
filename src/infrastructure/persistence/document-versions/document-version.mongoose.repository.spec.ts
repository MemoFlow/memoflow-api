import { Error as MongooseError } from 'mongoose';
import { DocumentVersionMongooseRepository } from './document-version.mongoose.repository';

function fakeId(hex: string) {
  return { toString: () => hex };
}

function fakeDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: fakeId('507f1f77bcf86cd799439011'),
    document_id: 'doc-1',
    user_id: 'user-1',
    version: 1,
    label: null,
    sections_snapshot: [
      {
        title: 'Intro',
        content: 'Hello',
        order: 0,
        status: 'draft',
        word_count: 1,
      },
    ],
    saved_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function duplicateKeyError() {
  const err = new Error('E11000 duplicate key error') as Error & {
    code: number;
  };
  err.code = 11000;
  return err;
}

function castError() {
  return new MongooseError.CastError('ObjectId', 'not-an-object-id', '_id');
}

describe('DocumentVersionMongooseRepository', () => {
  describe('create', () => {
    it('computes version = maxVersion + 1 and maps the created document', async () => {
      const findOneExec = jest.fn().mockResolvedValue({ version: 2 });
      const model = {
        findOne: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({ exec: findOneExec }),
          }),
        }),
        create: jest.fn().mockResolvedValue(fakeDoc({ version: 3 })),
      };
      const repository = new DocumentVersionMongooseRepository(model as any);

      const result = await repository.create({
        documentId: 'doc-1',
        userId: 'user-1',
        label: 'Milestone',
        sectionsSnapshot: [
          {
            title: 'Intro',
            content: 'Hello',
            order: 0,
            status: 'draft',
            wordCount: 1,
          },
        ],
      });

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({
          document_id: 'doc-1',
          user_id: 'user-1',
          version: 3,
          label: 'Milestone',
          sections_snapshot: [
            {
              title: 'Intro',
              content: 'Hello',
              order: 0,
              status: 'draft',
              word_count: 1,
            },
          ],
        }),
      );
      expect(result.version).toBe(3);
      expect(result.sectionsSnapshot[0].wordCount).toBe(1);
    });

    it('starts at version 1 when the document has no versions yet', async () => {
      const findOneExec = jest.fn().mockResolvedValue(null);
      const model = {
        findOne: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({ exec: findOneExec }),
          }),
        }),
        create: jest.fn().mockResolvedValue(fakeDoc({ version: 1 })),
      };
      const repository = new DocumentVersionMongooseRepository(model as any);

      await repository.create({
        documentId: 'doc-1',
        userId: 'user-1',
        sectionsSnapshot: [],
      });

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ version: 1 }),
      );
    });

    it('recomputes the max and retries once on a duplicate-key race, then succeeds', async () => {
      // First maxVersion() read returns 1 (both racing writers see the same
      // max); the insert with version=2 collides (E11000); the retry's
      // maxVersion() read now sees the winner's version=2, so it inserts
      // version=3 and succeeds.
      const findOneExec = jest
        .fn()
        .mockResolvedValueOnce({ version: 1 })
        .mockResolvedValueOnce({ version: 2 });
      const model = {
        findOne: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({ exec: findOneExec }),
          }),
        }),
        create: jest
          .fn()
          .mockRejectedValueOnce(duplicateKeyError())
          .mockResolvedValueOnce(fakeDoc({ version: 3 })),
      };
      const repository = new DocumentVersionMongooseRepository(model as any);

      const result = await repository.create({
        documentId: 'doc-1',
        userId: 'user-1',
        sectionsSnapshot: [],
      });

      expect(model.create).toHaveBeenCalledTimes(2);
      expect(model.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ version: 2 }),
      );
      expect(model.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ version: 3 }),
      );
      expect(result.version).toBe(3);
    });

    it('gives up after a second consecutive duplicate-key error', async () => {
      const findOneExec = jest.fn().mockResolvedValue({ version: 1 });
      const model = {
        findOne: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({ exec: findOneExec }),
          }),
        }),
        create: jest
          .fn()
          .mockRejectedValueOnce(duplicateKeyError())
          .mockRejectedValueOnce(duplicateKeyError()),
      };
      const repository = new DocumentVersionMongooseRepository(model as any);

      await expect(
        repository.create({
          documentId: 'doc-1',
          userId: 'user-1',
          sectionsSnapshot: [],
        }),
      ).rejects.toThrow('E11000');
      expect(model.create).toHaveBeenCalledTimes(2);
    });

    it('rethrows a non-duplicate-key failure without retrying', async () => {
      const findOneExec = jest.fn().mockResolvedValue(null);
      const model = {
        findOne: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({ exec: findOneExec }),
          }),
        }),
        create: jest.fn().mockRejectedValue(new Error('connection lost')),
      };
      const repository = new DocumentVersionMongooseRepository(model as any);

      await expect(
        repository.create({
          documentId: 'doc-1',
          userId: 'user-1',
          sectionsSnapshot: [],
        }),
      ).rejects.toThrow('connection lost');
      expect(model.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('findById', () => {
    it('returns the mapped domain entity when found', async () => {
      const exec = jest.fn().mockResolvedValue(fakeDoc());
      const model = { findById: jest.fn().mockReturnValue({ exec }) };
      const repository = new DocumentVersionMongooseRepository(model as any);

      const result = await repository.findById('507f1f77bcf86cd799439011');

      expect(model.findById).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
      expect(result?.id).toBe('507f1f77bcf86cd799439011');
      expect(result?.documentId).toBe('doc-1');
    });

    it('returns null when not found', async () => {
      const exec = jest.fn().mockResolvedValue(null);
      const model = { findById: jest.fn().mockReturnValue({ exec }) };
      const repository = new DocumentVersionMongooseRepository(model as any);

      const result = await repository.findById('missing-id');

      expect(result).toBeNull();
    });

    it('returns null (not a thrown error) when the id is not a valid ObjectId', async () => {
      const exec = jest.fn().mockRejectedValue(castError());
      const model = { findById: jest.fn().mockReturnValue({ exec }) };
      const repository = new DocumentVersionMongooseRepository(model as any);

      const result = await repository.findById('not-an-object-id');

      expect(result).toBeNull();
    });
  });

  describe('findByDocumentId', () => {
    it('maps the aggregation projection to metadata entries', async () => {
      const model = {
        aggregate: jest.fn().mockResolvedValue([
          {
            _id: fakeId('507f1f77bcf86cd799439011'),
            document_id: 'doc-1',
            version: 2,
            label: 'Milestone',
            saved_at: new Date('2026-01-02T00:00:00.000Z'),
            section_count: 3,
          },
        ]),
      };
      const repository = new DocumentVersionMongooseRepository(model as any);

      const result = await repository.findByDocumentId('doc-1');

      expect(model.aggregate).toHaveBeenCalledWith([
        { $match: { document_id: 'doc-1' } },
        { $sort: { saved_at: -1 } },
        {
          $project: {
            document_id: 1,
            version: 1,
            label: 1,
            saved_at: 1,
            section_count: { $size: { $ifNull: ['$sections_snapshot', []] } },
          },
        },
      ]);
      expect(result).toEqual([
        {
          id: '507f1f77bcf86cd799439011',
          documentId: 'doc-1',
          version: 2,
          label: 'Milestone',
          savedAt: new Date('2026-01-02T00:00:00.000Z'),
          sectionCount: 3,
        },
      ]);
    });
  });

  describe('maxVersion', () => {
    it('returns the highest existing version', async () => {
      const exec = jest.fn().mockResolvedValue({ version: 5 });
      const select = jest.fn().mockReturnValue({ exec });
      const sort = jest.fn().mockReturnValue({ select });
      const model = { findOne: jest.fn().mockReturnValue({ sort }) };
      const repository = new DocumentVersionMongooseRepository(model as any);

      const result = await repository.maxVersion('doc-1');

      expect(model.findOne).toHaveBeenCalledWith({ document_id: 'doc-1' });
      expect(sort).toHaveBeenCalledWith({ version: -1 });
      expect(result).toBe(5);
    });

    it('returns null when the document has no versions', async () => {
      const exec = jest.fn().mockResolvedValue(null);
      const select = jest.fn().mockReturnValue({ exec });
      const sort = jest.fn().mockReturnValue({ select });
      const model = { findOne: jest.fn().mockReturnValue({ sort }) };
      const repository = new DocumentVersionMongooseRepository(model as any);

      const result = await repository.maxVersion('doc-1');

      expect(result).toBeNull();
    });
  });
});
