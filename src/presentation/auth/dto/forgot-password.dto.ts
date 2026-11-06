import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'ada@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}
