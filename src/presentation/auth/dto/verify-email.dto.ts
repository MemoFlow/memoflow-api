import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({ description: 'Token from the emailed verification link' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token: string;
}
