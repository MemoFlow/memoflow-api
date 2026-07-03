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

  static fromDomain(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.display_name = user.displayName;
    dto.role = user.role;
    dto.xp = user.xp;
    dto.level = user.level;
    dto.last_active_at = user.lastActiveAt;
    return dto;
  }
}
