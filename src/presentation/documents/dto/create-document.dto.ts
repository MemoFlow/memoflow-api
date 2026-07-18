import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateDocumentDto {
  @ApiProperty({ example: 'Q3 Planning Doc' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'planning' })
  @IsString()
  @IsNotEmpty()
  docType: string;

  @ApiProperty({ example: 'draft', required: false })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ example: {}, required: false })
  @IsOptional()
  @IsObject()
  styleConfig?: Record<string, unknown>;
}
