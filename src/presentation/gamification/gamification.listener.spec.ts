import * as Sentry from '@sentry/nestjs';
import {
  DOCUMENT_CREATED_EVENT,
  SECTION_CREATED_EVENT,
  SECTION_UPDATED_EVENT,
} from '../../domain/documents/document-events';
import { HandleGamificationEventUseCase } from '../../application/gamification/handle-gamification-event.use-case';
import { GamificationListener } from './gamification.listener';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

function makeUseCase(): jest.Mocked<
  Pick<HandleGamificationEventUseCase, 'execute'>
> {
  return { execute: jest.fn() };
}

describe('GamificationListener', () => {
  it('delegates document.created to the use-case with the event name and payload', async () => {
    const useCase = makeUseCase();
    useCase.execute.mockResolvedValue(undefined);
    const listener = new GamificationListener(
      useCase as unknown as HandleGamificationEventUseCase,
    );

    const payload = { userId: 'user-1', documentId: 'doc-1' };
    await listener.onDocumentCreated(payload);

    expect(useCase.execute).toHaveBeenCalledWith(
      DOCUMENT_CREATED_EVENT,
      payload,
    );
  });

  it('delegates section.created to the use-case', async () => {
    const useCase = makeUseCase();
    useCase.execute.mockResolvedValue(undefined);
    const listener = new GamificationListener(
      useCase as unknown as HandleGamificationEventUseCase,
    );

    const payload = {
      userId: 'user-1',
      documentId: 'doc-1',
      sectionId: 'section-1',
    };
    await listener.onSectionCreated(payload);

    expect(useCase.execute).toHaveBeenCalledWith(
      SECTION_CREATED_EVENT,
      payload,
    );
  });

  it('delegates section.updated to the use-case', async () => {
    const useCase = makeUseCase();
    useCase.execute.mockResolvedValue(undefined);
    const listener = new GamificationListener(
      useCase as unknown as HandleGamificationEventUseCase,
    );

    const payload = {
      userId: 'user-1',
      documentId: 'doc-1',
      sectionId: 'section-1',
      wordCount: 120,
    };
    await listener.onSectionUpdated(payload);

    expect(useCase.execute).toHaveBeenCalledWith(
      SECTION_UPDATED_EVENT,
      payload,
    );
  });

  it('swallows a use-case failure instead of letting it propagate', async () => {
    const useCase = makeUseCase();
    useCase.execute.mockRejectedValue(new Error('db exploded'));
    const listener = new GamificationListener(
      useCase as unknown as HandleGamificationEventUseCase,
    );

    await expect(
      listener.onDocumentCreated({ userId: 'user-1', documentId: 'doc-1' }),
    ).resolves.toBeUndefined();
  });

  it('reports a swallowed use-case failure to Sentry without rethrowing', async () => {
    jest.clearAllMocks();
    const useCase = makeUseCase();
    const error = new Error('db exploded');
    useCase.execute.mockRejectedValue(error);
    const listener = new GamificationListener(
      useCase as unknown as HandleGamificationEventUseCase,
    );

    await expect(
      listener.onDocumentCreated({ userId: 'user-1', documentId: 'doc-1' }),
    ).resolves.toBeUndefined();

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });
});
