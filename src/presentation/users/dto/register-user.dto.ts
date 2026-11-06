import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';
import {
  BCRYPT_MAX_PASSWORD_BYTES,
  MaxByteLength,
} from '../../../shared/validators/max-byte-length.validator';

export class RegisterUserDto {
  @ApiProperty({ example: 'ada@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: 'correct-horse-battery-staple',
    minLength: 8,
    description: 'At most 72 bytes in UTF-8 (the bcrypt limit)',
  })
  @IsString()
  @MinLength(8)
  @MaxByteLength(BCRYPT_MAX_PASSWORD_BYTES)
  password: string;

  @ApiProperty({ example: 'Ada Lovelace' })
  @IsString()
  @IsNotEmpty()
  display_name: string;
}
