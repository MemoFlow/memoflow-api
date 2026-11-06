import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { makeUser } from '../../application/auth/testing-fakes';
import { User } from '../../domain/users/user.entity';
import { EmailVerifiedGuard } from './email-verified.guard';

function guard(required: boolean | undefined): EmailVerifiedGuard {
  return new EmailVerifiedGuard({
    get: () => required,
  } as unknown as ConfigService);
}

function context(user: User | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('EmailVerifiedGuard', () => {
  it('lets everyone through when verification is not required', () => {
    expect(guard(false).canActivate(context(makeUser()))).toBe(true);
    expect(guard(undefined).canActivate(context(makeUser()))).toBe(true);
  });

  it('rejects an unverified user with 403 when required', () => {
    expect(() => guard(true).canActivate(context(makeUser()))).toThrow(
      new ForbiddenException('Email not verified'),
    );
  });

  it('rejects a request without a user when required', () => {
    expect(() => guard(true).canActivate(context(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('lets a verified user through when required', () => {
    expect(
      guard(true).canActivate(
        context(makeUser({ emailVerifiedAt: new Date() })),
      ),
    ).toBe(true);
  });
});
