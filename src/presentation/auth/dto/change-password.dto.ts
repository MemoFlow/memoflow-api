import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  current_password: string;

  @ApiProperty({ example: 'correct-horse-battery-staple', minLength: 8 })
  @IsString()
  @MinLength(8)
  new_password: string;
}
