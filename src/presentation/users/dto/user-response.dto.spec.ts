import { makeUser } from '../../../application/auth/testing-fakes';
import { AI_NOTICE_VERSION } from '../../../domain/ai/ai-consent';
import { UserRole } from '../../../domain/users/user-role';
import { UserResponseDto } from './user-response.dto';

describe('UserResponseDto ai_consent', () => {
  const consenting = makeUser({
    aiConsentAt: new Date('2026-11-06T10:00:00Z'),
    aiConsentVersion: AI_NOTICE_VERSION,
  });

  it('is included with no viewer (the /users/me view)', () => {
    expect(UserResponseDto.fromDomain(consenting).ai_consent).toEqual({
      accepted_at: new Date('2026-11-06T10:00:00Z'),
      version: AI_NOTICE_VERSION,
      current_version: AI_NOTICE_VERSION,
      required: false,
    });
  });

  it('is included when the viewer is the same user', () => {
    expect(
      UserResponseDto.fromDomain(consenting, consenting).ai_consent,
    ).toBeDefined();
  });

  it('is omitted for another viewer, an admin included', () => {
    const other = makeUser({ id: 'other' });
    const admin = makeUser({ id: 'admin', role: UserRole.Admin });
    expect(
      UserResponseDto.fromDomain(consenting, other).ai_consent,
    ).toBeUndefined();
    expect(
      UserResponseDto.fromDomain(consenting, admin).ai_consent,
    ).toBeUndefined();
  });

  it('marks missing and stale consent as required', () => {
    expect(UserResponseDto.fromDomain(makeUser()).ai_consent).toMatchObject({
      accepted_at: null,
      version: null,
      required: true,
    });
    const stale = makeUser({
      aiConsentAt: new Date(),
      aiConsentVersion: '2020-01-01',
    });
    expect(UserResponseDto.fromDomain(stale).ai_consent).toMatchObject({
      version: '2020-01-01',
      required: true,
    });
  });
});
