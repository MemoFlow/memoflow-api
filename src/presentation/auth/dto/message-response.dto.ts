import { ApiProperty } from '@nestjs/swagger';

export class MessageResponseDto {
  @ApiProperty()
  message: string;

  static of(message: string): MessageResponseDto {
    const dto = new MessageResponseDto();
    dto.message = message;
    return dto;
  }
}
