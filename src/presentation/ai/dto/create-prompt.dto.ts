import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreatePromptDto {
  @ApiProperty({
    example: 'suggestion',
    description:
      'One of: suggestion, rewrite, summarize, expand, planning. Whether the prompt can be run by users is fixed by the type.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  feature_type: string;

  @ApiProperty({ example: 'v3', maxLength: 50 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  version: string;

  @ApiProperty({
    maxLength: 20000,
    description:
      'System message template. Allowed placeholders depend on the feature type (`{{nonce}}` always; `{{content}}` or `{{prompt}}`/`{{context}}`).',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  system_template: string;

  @ApiProperty({
    maxLength: 20000,
    description:
      'User message template. Must contain `{{content}}` (user-invocable types) or `{{prompt}}` (planning).',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  user_template: string;
}
