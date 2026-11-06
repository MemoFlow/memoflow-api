import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../../domain/users/user.entity';

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

  /**
   * `disabled_at` is included only when the viewer is an admin. Omit
   * `viewer` for contexts (e.g. registration) that never expose it.
   */
  static fromDomain(user: User, viewer?: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.display_name = user.displayName;
    dto.role = user.role;
    dto.xp = user.xp;
    dto.level = user.level;
    dto.last_active_at = user.lastActiveAt;
    if (viewer?.isAdmin) {
      dto.disabled_at = user.disabledAt;
    }
    return dto;
  }
}
