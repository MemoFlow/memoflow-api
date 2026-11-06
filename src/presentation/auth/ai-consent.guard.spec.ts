import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { makeUser } from '../../application/auth/testing-fakes';
import { AI_NOTICE_VERSION } from '../../domain/ai/ai-consent';
import { User } from '../../domain/users/user.entity';
import { AiConsentGuard } from './ai-consent.guard';

function context(user: User | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('AiConsentGuard', () => {
  const guard = new AiConsentGuard();

  function forbidden(user: User | undefined): ForbiddenException {
    try {
      guard.canActivate(context(user));
    } catch (err) {
      return err as ForbiddenException;
    }
    throw new Error('expected the guard to throw');
  }

  it('rejects a user with no consent with the AI_CONSENT_REQUIRED code', () => {
    const err = forbidden(makeUser());
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toEqual({
      message:
        'AI consent is required. Accept the current AI notice to use AI features.',
      error: 'AI_CONSENT_REQUIRED',
    });
  });

  it('rejects consent recorded for a stale notice version', () => {
    const err = forbidden(
      makeUser({ aiConsentAt: new Date(), aiConsentVersion: '2020-01-01' }),
    );
    expect(err.getResponse()).toMatchObject({ error: 'AI_CONSENT_REQUIRED' });
  });

  it('rejects a request without a user', () => {
    expect(() => guard.canActivate(context(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('lets a user with current consent through, admins included', () => {
    const consent = {
      aiConsentAt: new Date(),
      aiConsentVersion: AI_NOTICE_VERSION,
    };
    expect(guard.canActivate(context(makeUser(consent)))).toBe(true);
    expect(
      guard.canActivate(
        context(makeUser({ ...consent, role: 'admin' as never })),
      ),
    ).toBe(true);
  });
});
