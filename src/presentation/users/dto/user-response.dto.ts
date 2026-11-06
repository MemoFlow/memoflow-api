import { ApiProperty } from '@nestjs/swagger';
import { AI_NOTICE_VERSION } from '../../../domain/ai/ai-consent';
import { User } from '../../../domain/users/user.entity';

export class AiConsentDto {
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  accepted_at: Date | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The notice version consented to',
  })
  version: string | null;

  @ApiProperty({ description: 'The current AI notice version' })
  current_version: string;

  @ApiProperty({
    description: 'True when consent is missing or for an older notice version',
  })
  required: boolean;
}

/**
 * Response DTO for `users` — never includes `password_hash`.
 */
export class UserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  display_name: string;

  @ApiProperty()
  role: string;

  @ApiProperty({
    description: 'Whether the email address has been verified',
  })
  email_verified: boolean;

  @ApiProperty()
  xp: number;

  @ApiProperty()
  level: number;

  @ApiProperty({ nullable: true })
  last_active_at: Date | null;

  @ApiProperty({
    nullable: true,
    required: false,
    description: 'Present only in responses to an admin viewer',
  })
  disabled_at?: Date | null;

  @ApiProperty({
    type: AiConsentDto,
    required: false,
    description:
      "AI consent state. Present only in a user's own view, never for another viewer (even an admin)",
  })
  ai_consent?: AiConsentDto;

  /**
   * `disabled_at` is included only when the viewer is an admin. Omit
   * `viewer` for contexts (e.g. registration) that never expose it.
   * `ai_consent` is included for the account's own view only: when `viewer`
   * is omitted (the `/users/me` route) or is the same user.
   */
  static fromDomain(user: User, viewer?: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.display_name = user.displayName;
    dto.role = user.role;
    dto.email_verified = user.isEmailVerified;
    dto.xp = user.xp;
    dto.level = user.level;
    dto.last_active_at = user.lastActiveAt;
    if (!viewer || viewer.id === user.id) {
      dto.ai_consent = {
        accepted_at: user.aiConsentAt,
        version: user.aiConsentVersion,
        current_version: AI_NOTICE_VERSION,
        required: !user.hasCurrentAiConsent,
      };
    }
    if (viewer?.isAdmin) {
      dto.disabled_at = user.disabledAt;
    }
    return dto;
  }
}
