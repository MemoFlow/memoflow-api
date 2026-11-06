import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import {
  BCRYPT_MAX_PASSWORD_BYTES,
  MaxByteLength,
} from '../../../shared/validators/max-byte-length.validator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token from the emailed reset link' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token: string;

  @ApiProperty({
    example: 'correct-horse-battery-staple',
    minLength: 8,
    description: 'At most 72 bytes in UTF-8 (the bcrypt limit)',
  })
  @IsString()
  @MinLength(8)
  @MaxByteLength(BCRYPT_MAX_PASSWORD_BYTES)
  new_password: string;
}
